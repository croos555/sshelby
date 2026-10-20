// SSH agent integration (ssh-agent, KeePassXC's SSH agent, Pageant, Windows OpenSSH agent)

use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh::keys::HashAlg;
use serde_json::{json, Value};

use crate::store::store;
use crate::util::Result;

pub type Agent = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

#[cfg(windows)]
const WIN_OPENSSH_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

// Which agent to talk to, from Settings: auto = SSH_AUTH_SOCK, else the Windows OpenSSH pipe
pub fn agent_path() -> Option<String> {
    let (source, custom) = {
        let s = store();
        (s.setting_str("agentSource"), s.setting_str("agentPath"))
    };
    match source.as_str() {
        "pageant" => Some("pageant".into()),
        "custom" => Some(custom).filter(|p| !p.is_empty()),
        _ => {
            if let Ok(sock) = std::env::var("SSH_AUTH_SOCK") {
                if !sock.is_empty() {
                    return Some(sock);
                }
            }
            #[cfg(windows)]
            return Some(WIN_OPENSSH_PIPE.into());
            #[cfg(not(windows))]
            None
        }
    }
}

pub async fn connect(path: &str) -> anyhow::Result<Agent> {
    #[cfg(windows)]
    {
        if path == "pageant" {
            return Ok(AgentClient::connect_pageant().await?.dynamic());
        }
        return Ok(AgentClient::connect_named_pipe(path).await?.dynamic());
    }
    #[cfg(unix)]
    {
        if path == "pageant" {
            anyhow::bail!("Pageant is only available on Windows");
        }
        Ok(AgentClient::connect_uds(path).await?.dynamic())
    }
}

pub fn identity_key(id: &AgentIdentity) -> Option<&russh::keys::PublicKey> {
    match id {
        AgentIdentity::PublicKey { key, .. } => Some(key),
        _ => None,
    }
}

pub fn fingerprint(key: &russh::keys::PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

#[tauri::command]
pub async fn agent_list() -> Result<Vec<Value>> {
    let Some(path) = agent_path() else {
        crate::bail!("No SSH agent found. Start one (or enable KeePassXC’s SSH Agent integration) or set its socket in Settings.");
    };
    let mut agent = connect(&path)
        .await
        .map_err(|e| anyhow::anyhow!("Cannot reach the SSH agent ({path}): {e}"))?;
    let ids = agent
        .request_identities()
        .await
        .map_err(|e| anyhow::anyhow!("Cannot reach the SSH agent ({path}): {e}"))?;
    Ok(ids
        .iter()
        .filter_map(|id| {
            let AgentIdentity::PublicKey { key, comment } = id else { return None };
            Some(json!({ "type": key.algorithm().as_str(), "comment": comment, "fingerprint": fingerprint(key) }))
        })
        .collect())
}

#[tauri::command]
pub fn agent_path_cmd() -> Option<String> {
    agent_path()
}
