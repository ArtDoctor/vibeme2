//! Basic profanity masking for proximity chat (case-insensitive substring replace).

const BANNED: &[&str] = &[
    "fuck", "shit", "bitch", "bastard", "damn", "crap", "piss", "slut", "whore", "dick",
    "cock", "cunt", "pussy", "fag", "nazi",
];

/// Replaces known vulgar substrings with asterisks.
pub fn filter_profanity(input: &str) -> String {
    let mut out = input.to_string();
    for word in BANNED {
        let stars = "*".repeat(word.len().min(6));
        loop {
            let lower = out.to_lowercase();
            let Some(idx) = lower.find(word) else {
                break;
            };
            let end = idx + word.len();
            out.replace_range(idx..end, &stars);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_common_word() {
        let s = filter_profanity("what the shit");
        assert!(!s.to_lowercase().contains("shit"));
        assert!(s.contains('*'));
    }
}
