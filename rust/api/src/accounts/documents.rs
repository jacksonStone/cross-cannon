//! Small account/consent documents. Identity is resolved on the server; browser
//! JavaScript performs only explicit sign-in, sign-out, and app approval actions.
use super::store::{PendingLogin, User};

pub(super) const SCRIPT: &str = include_str!("assets/account.js");
pub(super) const CSS: &str = include_str!("assets/account.css");

fn escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

pub(super) fn render(
    user: Option<&User>,
    login: Option<&PendingLogin>,
    native: bool,
    configured: bool,
    failed: bool,
) -> String {
    let title = if native { "Connect your app" } else { "Your account" };
    let heading = if native { "Sign in to Cross Canon." }
        else if user.is_some() { "Your account" } else { "Pick up where you left off." };
    let page = if native { "native" } else { "account" };
    let class = if native { "account-page native-sign-in-page" } else { "account-page" };
    let request_id = escape(login.map(|login| login.id.as_str()).unwrap_or(""));
    let mut document = format!(r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#fbfaf7">
<title>{title} | Cross Canon</title>
<link rel="icon" href="/favicon-c26c421629d8.svg" type="image/svg+xml">
<link rel="stylesheet" href="/account-assets/account.css">
<script type="module" src="/account-assets/account.js"></script>
</head>
<body>
<main class="{class}" data-page="{page}" data-request-id="{request_id}" data-configured="{configured}">
"##);
    if !native {
        document.push_str(r#"<a href="/" class="account-back">← Back to reading</a>"#);
    }
    document.push_str(&format!(r#"<div class="account-brand">CROSS CANON</div><h1 id="account-heading">{heading}</h1>"#));
    if !native {
        document.push_str(r#"<p class="account-intro">Keep your reading and notes together across devices.</p>"#);
    }
    document.push_str(r#"<section class="account-card" aria-label="Your account" aria-busy="false"><div id="account-prompt">"#);
    if native {
        if let Some(login) = login {
            document.push_str(&format!("<h2>{}</h2>",escape(&login.label)));
            if let Some(user) = user {
                let name = if user.name.is_empty() { "your Google account" } else { &user.name };
                document.push_str(&format!("<p>{}</p><p>Keep your reading progress in sync with this app.</p>",escape(&user.email)));
                document.push_str(&button("approve", &format!("Continue as {name}"), !configured));
                document.push_str(r#"<a href="/account">Use a different account</a>"#);
            } else {
                document.push_str(&button("sign-in", "Continue with Google", !configured));
            }
        } else {
            document.push_str(r#"<p>This connection has expired. Tap Continue with Google again in the app.</p><a href="/account">Your account</a>"#);
        }
    } else if let Some(user) = user {
        document.push_str(&format!(r#"<h2>{}</h2><p class="account-email">{}</p>"#,escape(&user.name),escape(&user.email)));
        document.push_str(&button("sign-out", "Sign out", false));
    } else {
        document.push_str(&button("sign-in", "Continue with Google", !configured));
    }
    document.push_str(r#"</div><div id="native-return" hidden><p>Return to the app to finish signing in and sync your reading progress.</p><a id="native-return-link" class="google-sign-in">Return to Cross Canon</a></div>"#);
    let unavailable = !configured && user.is_none();
    document.push_str(&format!(r#"<p id="account-status" role="status" aria-live="polite"{}>{}</p>"#,
        if unavailable { "" } else { " hidden" },
        if unavailable { "Google sign-in is unavailable right now. You can continue reading." } else { "" }));
    document.push_str(&format!(r#"<p id="account-error" role="alert"{}>{}</p>"#,
        if failed { "" } else { " hidden" },
        if failed { "Google sign-in could not be completed. Please try again." } else { "" }));
    document.push_str("</section></main></body></html>");
    document
}

fn button(action: &str, label: &str, disabled: bool) -> String {
    format!(r#"<button id="account-action" type="button" class="google-sign-in" data-action="{}"{}>{}</button>"#,
        escape(action), if disabled { " disabled" } else { "" }, escape(label))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn user() -> User { User {id:"private-user-id".into(),name:"Reader".into(),email:"reader@example.com".into()} }
    fn login() -> PendingLogin { PendingLogin {id:"a".repeat(64),label:"Cross Canon on iPhone".into()} }

    #[test]
    fn account_and_native_documents_preserve_the_sign_in_and_consent_states() {
        let user = user();
        let login = login();
        let guest = render(None,None,false,true,false);
        assert!(guest.contains("Pick up where you left off."));
        assert!(guest.contains("← Back to reading"));
        assert!(guest.contains(r#"data-action="sign-in""#));
        assert!(!guest.contains(" disabled"));
        assert!(!guest.contains("Checking sign-in"),"Resolved server identity needs no loading request");
        let account = render(Some(&user),None,false,true,false);
        assert!(account.contains("<h2>Reader</h2>"));
        assert!(account.contains("reader@example.com"));
        assert!(account.contains(r#"data-action="sign-out""#));
        assert!(!account.contains(&user.id));
        let native = render(None,Some(&login),true,true,false);
        assert!(native.contains(&format!(r#"data-request-id="{}""#,login.id)));
        assert!(native.contains("Cross Canon on iPhone"));
        assert!(native.contains(r#"data-action="sign-in""#));
        let consent = render(Some(&user),Some(&login),true,true,false);
        assert!(consent.contains("Continue as Reader"));
        assert!(consent.contains(r#"data-action="approve""#));
        assert!(consent.contains("Use a different account"));
        assert!(consent.contains(r#"id="native-return-link""#));
        let expired = render(Some(&user),None,true,true,false);
        assert!(expired.contains("This connection has expired."));
        assert!(!expired.contains(r#"id="account-action""#));
        assert!(!expired.contains("reader@example.com"));
        let unavailable = render(None,None,false,false,true);
        assert!(unavailable.contains(r#"data-action="sign-in" disabled"#));
        assert!(unavailable.contains("Google sign-in is unavailable right now."));
        assert!(unavailable.contains(r#"id="account-error" role="alert">Google sign-in could not be completed."#));
    }

    #[test]
    fn untrusted_identity_and_request_text_are_only_escaped_html_data() {
        let attack = "\"><img src=x onerror=alert(1)>&'\"</script>";
        let user = User {id:"not-rendered".into(),name:attack.into(),email:attack.into()};
        let login = PendingLogin {id:attack.into(),label:attack.into()};
        for native in [false,true] {
            let document = render(Some(&user),Some(&login),native,true,false);
            assert!(!document.contains(attack));
            assert!(!document.contains("<img"));
            assert!(document.contains("&quot;&gt;&lt;img"));
            assert!(document.contains("&amp;&#39;&quot;&lt;/script&gt;"));
            assert_eq!(document.matches("<script").count(),1);
            assert!(document.contains(r#"<script type="module" src="/account-assets/account.js"></script>"#));
            assert!(!document.contains("<script>"));
            assert!(!document.contains("javascript:"));
        }
        assert!(!SCRIPT.contains("innerHTML"));
        assert!(!SCRIPT.contains("get-session"));
        assert!(CSS.contains("/browser/fonts/SourceSerif4-Semibold.ttf"));
        assert!(CSS.contains("/browser/fonts/Inter.ttf"));
    }
}
