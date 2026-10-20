// SSH keys: generation, inspection, installation on a host

use std::sync::Arc;

use russh::keys::ssh_key::{private::PrivateKey, Algorithm, EcdsaCurve, HashAlg, LineEnding};
use russh::keys::{decode_secret_key, ssh_key};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::ssh::with_connection;
use crate::store::store;
use crate::util::Result;

fn normalize_type(ssh_type: &str) -> &'static str {
    if ssh_type.contains("ed25519") {
        "ed25519"
    } else if ssh_type.contains("rsa") {
        "rsa"
    } else if ssh_type.contains("ecdsa") {
        "ecdsa"
    } else {
        "unknown"
    }
}

pub fn key_info(key: &PrivateKey, pem: &str) -> anyhow::Result<Value> {
    let public = key.public_key();
    Ok(json!({
        "type": normalize_type(key.algorithm().as_str()),
        "publicKey": public.to_openssh()?,
        "privateKey": format!("{}\n", pem.trim()),
        "fingerprint": public.fingerprint(HashAlg::Sha256).to_string()
    }))
}

// Parse a private key (OpenSSH, PKCS#1/#8, PuTTY) and derive public key + fingerprint
pub fn inspect(pem: &str, passphrase: Option<&str>) -> anyhow::Result<Value> {
    if pem.contains("PUBLIC KEY") || pem.trim_start().starts_with("ssh-") {
        anyhow::bail!("This is a public key; paste the private key");
    }
    let key = decode_secret_key(pem, passphrase.filter(|p| !p.is_empty())).map_err(|e| {
        let msg = e.to_string();
        if passphrase.is_none_or(str::is_empty) && (msg.to_lowercase().contains("encrypt") || msg.to_lowercase().contains("passphrase")) {
            anyhow::anyhow!("Key is encrypted: passphrase required")
        } else {
            anyhow::anyhow!(msg)
        }
    })?;
    key_info(&key, pem)
}

#[derive(Deserialize)]
pub struct GenOpts {
    bits: Option<u32>,
    comment: Option<String>,
    passphrase: Option<String>,
}

#[tauri::command]
pub async fn keys_generate(r#type: String, opts: GenOpts) -> Result<Value> {
    // RSA generation takes a while: keep it off the async workers
    Ok(tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Value> {
        let algorithm = match r#type.as_str() {
            "rsa" => Algorithm::Rsa { hash: None },
            "ecdsa" => Algorithm::Ecdsa {
                curve: match opts.bits {
                    Some(384) => EcdsaCurve::NistP384,
                    Some(521) => EcdsaCurve::NistP521,
                    _ => EcdsaCurve::NistP256,
                },
            },
            _ => Algorithm::Ed25519,
        };
        let mut rng = rand::rng();
        let mut key = if r#type == "rsa" {
            let bits = opts.bits.unwrap_or(4096) as usize;
            PrivateKey::from(ssh_key::private::RsaKeypair::random(&mut rng, bits)?)
        } else {
            PrivateKey::random(&mut rng, algorithm)?
        };
        key.set_comment(opts.comment.filter(|c| !c.is_empty()).unwrap_or_else(|| "sshelby".into()));
        let plain = key.clone();
        if let Some(pass) = opts.passphrase.as_deref().filter(|p| !p.is_empty()) {
            key = key.encrypt(&mut rng, pass)?;
        }
        let pem = key.to_openssh(LineEnding::LF)?;
        key_info(&plain, &pem)
    })
    .await??)
}

#[tauri::command]
pub fn keys_inspect(private_key: String, passphrase: Option<String>) -> Result<Value> {
    Ok(inspect(&private_key, passphrase.as_deref())?)
}

#[tauri::command]
pub async fn keys_install_on_host(key_id: String, host_id: String) -> Result<()> {
    let key = store().find("keys", &key_id).ok_or_else(|| anyhow::anyhow!("Key not found"))?;
    let public = key["publicKey"].as_str().unwrap_or_default().trim().replace('\'', "");
    // Idempotent: only append when the key is not already present
    let cmd = format!(
        "umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && \
         (grep -qxF '{public}' ~/.ssh/authorized_keys || echo '{public}' >> ~/.ssh/authorized_keys)"
    );
    with_connection(&host_id, |conn: Arc<crate::ssh::Connection>| async move {
        let (_, err, code) = conn.exec(&cmd).await?;
        match code {
            Some(0) | None => Ok(()),
            Some(c) => Err(anyhow::anyhow!(if err.trim().is_empty() { format!("exit {c}") } else { err.trim().to_string() })),
        }
    })
    .await?;
    Ok(())
}
