// Encryption of vault secrets at rest. A random 256-bit key lives in the OS keychain
// (macOS Keychain, Windows Credential Manager, Secret Service on Linux); values are AES-256-GCM.

use std::sync::OnceLock;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use crate::util::random_bytes;

const PREFIX: &str = "enc:v2:";
// Written by the former Electron build (Chromium os_crypt through safeStorage)
pub const ELECTRON_PREFIX: &str = "enc:v1:";
const SERVICE: &str = "dev.sshelby.app";
const ACCOUNT: &str = "vault-key";

static KEY: OnceLock<Option<[u8; 32]>> = OnceLock::new();

fn master_key() -> Option<&'static [u8; 32]> {
    KEY.get_or_init(|| {
        let entry = keyring::Entry::new(SERVICE, ACCOUNT).ok()?;
        match entry.get_password() {
            Ok(b64) => B64.decode(b64).ok()?.try_into().ok(),
            Err(keyring::Error::NoEntry) => {
                let key = random_bytes::<32>();
                entry.set_password(&B64.encode(key)).ok()?;
                Some(key)
            }
            Err(_) => None,
        }
    })
    .as_ref()
}

pub fn available() -> bool {
    master_key().is_some()
}

pub fn backend() -> &'static str {
    if cfg!(target_os = "macos") {
        "keychain"
    } else if cfg!(windows) {
        "credential-manager"
    } else {
        "secret-service"
    }
}

pub fn encrypt(value: &str) -> String {
    let Some(key) = master_key() else { return value.to_string() };
    if value.is_empty() {
        return String::new();
    }
    let cipher = Aes256Gcm::new_from_slice(key).expect("32-byte key");
    let nonce = random_bytes::<12>();
    let Ok(ct) = cipher.encrypt(Nonce::from_slice(&nonce), value.as_bytes()) else {
        return value.to_string();
    };
    let mut out = nonce.to_vec();
    out.extend(ct);
    format!("{PREFIX}{}", B64.encode(out))
}

pub fn decrypt(value: &str) -> String {
    if let Some(rest) = value.strip_prefix(PREFIX) {
        let (Some(key), Ok(raw)) = (master_key(), B64.decode(rest)) else { return String::new() };
        if raw.len() < 12 {
            return String::new();
        }
        let cipher = Aes256Gcm::new_from_slice(key).expect("32-byte key");
        return cipher
            .decrypt(Nonce::from_slice(&raw[..12]), &raw[12..])
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_default();
    }
    if let Some(rest) = value.strip_prefix(ELECTRON_PREFIX) {
        return electron::decrypt(rest).unwrap_or_default();
    }
    value.to_string()
}

// One-time migration from the former Electron build's vault: Chromium os_crypt "v10" values,
// AES-128-CBC with a key derived from a password stored in the keychain.
mod electron {
    use super::B64;
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    use base64::Engine;
    use std::sync::OnceLock;

    type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

    static PASSWORD: OnceLock<Option<String>> = OnceLock::new();

    fn password() -> Option<&'static str> {
        PASSWORD
            .get_or_init(|| {
                if cfg!(target_os = "macos") {
                    // Electron names the item "<App> Safe Storage"; macOS asks the user before handing it over
                    for name in ["sshelby", "Sshelby"] {
                        for account in [format!("{name} Key"), name.to_string()] {
                            let service = format!("{name} Safe Storage");
                            if let Ok(p) = keyring::Entry::new(&service, &account).and_then(|e| e.get_password()) {
                                return Some(p);
                            }
                        }
                    }
                    None
                } else if cfg!(target_os = "linux") {
                    // Basic text backend (no keyring): Chromium's fixed password
                    Some("peanuts".to_string())
                } else {
                    // Windows (DPAPI) is not supported by this test build: re-enter those secrets
                    None
                }
            })
            .as_deref()
    }

    pub fn decrypt(b64: &str) -> Option<String> {
        let raw = B64.decode(b64).ok()?;
        let body = raw.strip_prefix(b"v10")?;
        let iterations = if cfg!(target_os = "macos") { 1003 } else { 1 };
        let mut key = [0u8; 16];
        pbkdf2::pbkdf2_hmac::<sha1::Sha1>(password()?.as_bytes(), b"saltysalt", iterations, &mut key);
        let iv = [b' '; 16];
        let plain = Aes128CbcDec::new(&key.into(), &iv.into()).decrypt_padded_vec_mut::<Pkcs7>(body).ok()?;
        String::from_utf8(plain).ok()
    }
}
