fn main() {
    // Inject GIT_SHA so lib.rs::pipeline_version() can stamp every
    // DocumentExtracted event with the exact rule-set git revision the
    // binary was built from. Required for the medico-legal persistence
    // boundary's deterministic-replay guarantee.
    //
    // Resolution order:
    //   1. The build environment already set GIT_SHA (CI / packaging).
    //   2. `git rev-parse --short HEAD` succeeds — repo build.
    //   3. Fall back to "dev". Local development builds may still be
    //      replayable as long as the rule_corpus_hash matches.
    let git_sha = std::env::var("GIT_SHA")
        .ok()
        .or_else(|| {
            std::process::Command::new("git")
                .args(["rev-parse", "--short=12", "HEAD"])
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        if s.is_empty() { None } else { Some(s) }
                    } else {
                        None
                    }
                })
        })
        .unwrap_or_else(|| "dev".to_string());

    println!("cargo:rustc-env=GIT_SHA={git_sha}");
    // Re-run when HEAD moves so the stamped sha stays accurate.
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/refs");
    println!("cargo:rerun-if-env-changed=GIT_SHA");

    tauri_build::build()
}
