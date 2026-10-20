// Remote resource sampling for the terminal status bar (port of stats-core.ts)

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::{json, Value};

// One round trip: CPU counters, memory, load and disk usage, separated by markers
pub const STATS_COMMAND: &str = "head -1 /proc/stat 2>/dev/null; echo @@; \
grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null; echo @@; \
cat /proc/loadavg 2>/dev/null; echo @@; \
nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null; echo @@; \
df -kP 2>/dev/null";

// Pseudo or uninteresting filesystems
static SKIP_FS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(tmpfs|devtmpfs|udev|overlay|shm|none|squashfs|efivarfs|cgroup.*|proc|sysfs|run|map .*)$").unwrap());
// Container bind mounts under /etc, macOS system sub-volumes and simulator images are noise
static SKIP_MOUNT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/(dev|proc|sys|run|snap|etc|var/lib/docker|var/snap|boot/efi)(/|$)|^/System/Volumes/|^/Library/Developer/").unwrap()
});
static DF_LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$").unwrap());

#[derive(Clone, Copy)]
pub struct CpuSample {
    idle: u64,
    total: u64,
}

pub fn parse_stats(out: &str, prev: Option<CpuSample>) -> (Value, Option<CpuSample>) {
    let parts: Vec<&str> = out.split("\n@@\n").collect();
    let part = |i: usize| parts.get(i).copied().unwrap_or("");
    let mut stats = json!({ "disks": [] });

    // cpu  user nice system idle iowait irq softirq steal ...
    let mut sample = None;
    if let Some(line) = part(0).lines().find(|l| l.starts_with("cpu ")) {
        let v: Vec<u64> = line.split_whitespace().skip(1).map(|x| x.parse().unwrap_or(0)).collect();
        let idle = v.get(3).unwrap_or(&0) + v.get(4).unwrap_or(&0);
        let total: u64 = v.iter().take(8).sum();
        sample = Some(CpuSample { idle, total });
        if let Some(p) = prev.filter(|p| total > p.total) {
            let busy = 1.0 - (idle.saturating_sub(p.idle)) as f64 / (total - p.total) as f64;
            stats["cpu"] = json!((busy * 100.0).clamp(0.0, 100.0));
        }
    }

    let mut mem = std::collections::HashMap::new();
    for line in part(1).lines() {
        let mut it = line.split_whitespace();
        if let (Some(k), Some(v)) = (it.next(), it.next()) {
            if let Ok(n) = v.parse::<u64>() {
                mem.insert(k.trim_end_matches(':').to_string(), n * 1024);
            }
        }
    }
    let m = |k: &str| mem.get(k).copied();
    if let Some(total) = m("MemTotal") {
        // Older kernels lack MemAvailable
        let avail = m("MemAvailable").unwrap_or(m("MemFree").unwrap_or(0) + m("Buffers").unwrap_or(0) + m("Cached").unwrap_or(0));
        stats["mem"] = json!({ "used": total.saturating_sub(avail), "total": total });
    }
    if let Some(total) = m("SwapTotal").filter(|t| *t > 0) {
        stats["swap"] = json!({ "used": total.saturating_sub(m("SwapFree").unwrap_or(0)), "total": total });
    }

    let load: Vec<f64> = part(2).split_whitespace().take(3).filter_map(|x| x.parse().ok()).collect();
    if load.len() == 3 {
        stats["load"] = json!(load);
    }
    if let Ok(n) = part(3).trim().parse::<u32>() {
        if n > 0 {
            stats["cores"] = json!(n);
        }
    }

    let mut disks: Vec<(String, u64, u64)> = Vec::new();
    let mut seen = HashSet::new();
    for line in part(4).trim().lines().skip(1) {
        let Some(c) = DF_LINE.captures(line) else { continue };
        let (fs, size, used, avail, mount) = (&c[1], &c[2], &c[3], &c[4], c[6].to_string());
        let data_volume = mount == "/System/Volumes/Data";
        // "/" always counts, even on an overlay (containers, LXC)
        if mount != "/" && !data_volume && (SKIP_FS.is_match(fs) || SKIP_MOUNT.is_match(&mount)) {
            continue;
        }
        if size == "0" {
            continue;
        }
        // Same device mounted twice (bind mounts): keep the first
        if fs.starts_with('/') && !seen.insert(fs.to_string()) {
            continue;
        }
        let used: u64 = used.parse().unwrap_or(0);
        let avail: u64 = avail.parse().unwrap_or(0);
        disks.push((mount, used * 1024, (used + avail) * 1024));
    }
    // macOS: the user's data lives on the Data volume, "/" is the sealed system snapshot
    if let Some(i) = disks.iter().position(|d| d.0 == "/System/Volumes/Data") {
        let mut data = disks.remove(i);
        data.0 = "/".into();
        disks.retain(|d| d.0 != "/");
        disks.insert(0, data);
    }
    // Root first, then the largest ones
    disks.sort_by(|a, b| match (a.0 == "/", b.0 == "/") {
        (true, _) => std::cmp::Ordering::Less,
        (_, true) => std::cmp::Ordering::Greater,
        _ => b.2.cmp(&a.2),
    });
    disks.truncate(5);
    stats["disks"] = json!(disks.iter().map(|(m, u, t)| json!({ "mount": m, "used": u, "total": t })).collect::<Vec<_>>());
    (stats, sample)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "cpu  100 0 100 800 0 0 0 0 0 0\n@@\nMemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n@@\n0.50 0.40 0.30 1/100 42\n@@\n4\n@@\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 60 40 60% /\ntmpfs 50 1 49 2% /run\n/dev/sdb1 1000 10 990 1% /data\n";

    #[test]
    fn parses_memory_load_cores_and_disks() {
        let (stats, sample) = parse_stats(SAMPLE, None);
        assert!(sample.is_some());
        assert!(stats.get("cpu").is_none(), "CPU needs two samples");
        assert_eq!(stats["mem"]["used"], 600 * 1024);
        assert!(stats.get("swap").is_none(), "no swap configured");
        assert_eq!(stats["load"][0], 0.5);
        assert_eq!(stats["cores"], 4);
        let mounts: Vec<&str> = stats["disks"].as_array().unwrap().iter().map(|d| d["mount"].as_str().unwrap()).collect();
        assert_eq!(mounts, ["/", "/data"], "root first, pseudo filesystems skipped");
    }

    #[test]
    fn cpu_percent_from_two_samples() {
        let (_, first) = parse_stats(SAMPLE, None);
        let next = SAMPLE.replace("cpu  100 0 100 800", "cpu  150 0 150 900");
        let (stats, _) = parse_stats(&next, first);
        assert_eq!(stats["cpu"], 50.0);
    }
}
