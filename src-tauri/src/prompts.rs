// Interactive prompts raised during connection (host key, password, keyboard-interactive):
// the renderer shows a modal and answers through prompt_respond.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Value};
use tokio::sync::oneshot;

use crate::util::{emit, uuid};

static PENDING: LazyLock<Mutex<HashMap<String, oneshot::Sender<Value>>>> = LazyLock::new(Default::default);

pub async fn ask(mut req: Value) -> Value {
    let id = uuid();
    req["id"] = json!(id);
    let (tx, rx) = oneshot::channel();
    PENDING.lock().unwrap().insert(id.clone(), tx);
    emit("prompt:request", req);
    rx.await.unwrap_or_else(|_| json!({ "id": id, "values": null }))
}

// First value of a password / keyboard-interactive answer, and whether "save" was ticked
pub fn first_value(res: &Value) -> (Option<String>, bool) {
    let v = res["values"].as_array().and_then(|a| a.first()).and_then(Value::as_str).map(String::from);
    (v, res["save"].as_bool().unwrap_or(false))
}

pub async fn ask_secret(title: &str, message: &str, offer_save: bool) -> (Option<String>, bool) {
    let res = ask(json!({ "kind": "password", "title": title, "message": message, "offerSave": offer_save })).await;
    first_value(&res)
}

#[tauri::command]
pub fn prompt_respond(res: Value) {
    let Some(id) = res["id"].as_str() else { return };
    if let Some(tx) = PENDING.lock().unwrap().remove(id) {
        let _ = tx.send(res);
    }
}
