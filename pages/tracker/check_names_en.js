// English check-completion names, keyed by the same global id CHECK_ID_MAP
// uses. Empty for now -- see tracker/check_audit.html to author these
// against the raw ported short codes in CHECK_ID_MAP. A confident
// best-effort pass wasn't done here: several short codes' boss-abbreviation
// initials don't cleanly match known Mega Man X boss names without further
// verification (e.g. the X1 set's "BN"/"IP" codes), so guessing risked
// embedding wrong names into the very file meant to fix that.
const CHECK_NAMES_EN = {};
