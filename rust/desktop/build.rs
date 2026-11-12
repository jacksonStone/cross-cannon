fn main() {
    println!("cargo:rerun-if-changed=src/apple_audio.m");
    println!("cargo:rerun-if-changed=src/apple_links.m");
    println!("cargo:rerun-if-changed=src/apple_account.m");
    let target = std::env::var("TARGET").unwrap();
    if !target.contains("apple") {
        return;
    }
    let sdk = if target.ends_with("ios-sim") {
        "iphonesimulator"
    } else if target.ends_with("ios") {
        "iphoneos"
    } else {
        "macosx"
    };
    let developer = "/Applications/Xcode.app/Contents/Developer";
    let output = std::process::Command::new("xcrun")
        .env(
            "DEVELOPER_DIR",
            std::env::var("DEVELOPER_DIR").unwrap_or_else(|_| developer.into()),
        )
        .args(["--sdk", sdk, "--show-sdk-path"])
        .output()
        .expect("Xcode SDK is required");
    assert!(output.status.success(), "Xcode SDK is unavailable");
    let sdk_path = String::from_utf8(output.stdout).unwrap();
    cc::Build::new()
        .file("src/apple_audio.m")
        .file("src/apple_links.m")
        .file("src/apple_account.m")
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-isysroot")
        .flag(sdk_path.trim())
        .compile("cross_canon_apple_audio");
    for framework in [
        "Foundation",
        "AVFoundation",
        "CoreMedia",
        "MediaPlayer",
        "Security",
        "AuthenticationServices",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
