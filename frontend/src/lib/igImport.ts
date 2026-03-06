function normalizeUrl(raw) {
    if (!raw)
        return null;
    let s = raw.trim();
    if (!s)
        return null;
    if (s.startsWith("www."))
        s = `https://${s}`;
    if (s.startsWith("instagram.com"))
        s = `https://${s}`;
    try {
        const u = new URL(s);
        if (!u.hostname.includes("instagram.com"))
            return null;
        const p = u.pathname.replace(/\/+$/, "");
        const isAcceptedInstagramPost = p.startsWith("/reel/") ||
            p.startsWith("/reels/") ||
            p.startsWith("/p/") ||
            p.startsWith("/tv/");
        if (!isAcceptedInstagramPost)
            return null;
        u.search = "";
        u.hash = "";
        u.protocol = "https:";
        return u.toString();
    }
    catch {
        return null;
    }
}
function isObject(x) {
    return typeof x === "object" && x !== null;
}
function getString(x) {
    return typeof x === "string" ? x : null;
}
function getNumber(x) {
    return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function pushRejected(rejected, reason, sample) {
    if (rejected.length >= 5000)
        return;
    rejected.push({ reason, sample: sample.slice(0, 180) });
}
function extractUrlFromText(text) {
    const m = text.match(/https?:\/\/[^\s)\]}>\"]+/i) ||
        text.match(/(?:www\.)instagram\.com\/[^\s)\]}>\"]+/i) ||
        text.match(/instagram\.com\/[^\s)\]}>\"]+/i);
    return m?.[0] ?? null;
}
function collectParticipants(json) {
    if (!isObject(json))
        return [];
    const raw = json["participants"];
    if (!Array.isArray(raw))
        return [];
    const out = new Set();
    for (const entry of raw) {
        if (!isObject(entry))
            continue;
        const name = getString(entry["name"]);
        if (name?.trim())
            out.add(name.trim());
    }
    return Array.from(out).slice(0, 60);
}
function pushShareFromMessage(out, rejected, args) {
    const sender = args.sender_name?.trim();
    const link = args.raw_url?.trim();
    if (!sender || !link)
        return;
    const normalized = normalizeUrl(link);
    if (!normalized) {
        pushRejected(rejected, "not_supported_instagram_url", link);
        return;
    }
    out.push({
        url: normalized,
        sender_name: sender,
        file_name: args.file_name,
        timestamp_ms: args.timestamp_ms,
    });
}
function collectSharesFromMessages(json, out, rejected, file_name, participants) {
    if (!isObject(json)) {
        pushRejected(rejected, "invalid_root_object", file_name);
        return;
    }
    const messages = json["messages"];
    if (!Array.isArray(messages)) {
        pushRejected(rejected, "missing_messages_array", file_name);
        return;
    }
    for (const message of messages) {
        if (!isObject(message))
            continue;
        const sender_name = getString(message["sender_name"]);
        if (sender_name?.trim())
            participants.add(sender_name.trim());
        const timestamp_ms = getNumber(message["timestamp_ms"]) ?? undefined;
        const share = message["share"];
        if (isObject(share)) {
            const shareLink = getString(share["link"]) ?? getString(share["url"]);
            pushShareFromMessage(out, rejected, {
                sender_name,
                timestamp_ms,
                file_name,
                raw_url: shareLink,
            });
        }
        const content = getString(message["content"]);
        if (sender_name && content && content.includes("instagram.com")) {
            pushShareFromMessage(out, rejected, {
                sender_name,
                timestamp_ms,
                file_name,
                raw_url: extractUrlFromText(content),
            });
        }
    }
}
export async function importInstagramJsonFiles(files) {
    const allShares = [];
    const allRejected = [];
    const by_file = [];
    for (const f of files) {
        const fileRejected = [];
        const participants = new Set();
        let text = "";
        try {
            text = await f.text();
        }
        catch {
            pushRejected(fileRejected, "read_failed", f.name);
            by_file.push({
                file_name: f.name,
                shares_added: 0,
                rejected_count: fileRejected.length,
                rejected_samples: fileRejected.slice(0, 200),
                participants_detected: [],
            });
            allRejected.push(...fileRejected);
            continue;
        }
        let json;
        try {
            json = JSON.parse(text);
        }
        catch {
            pushRejected(fileRejected, "json_parse_failed", f.name);
            by_file.push({
                file_name: f.name,
                shares_added: 0,
                rejected_count: fileRejected.length,
                rejected_samples: fileRejected.slice(0, 200),
                participants_detected: [],
            });
            allRejected.push(...fileRejected);
            continue;
        }
        for (const name of collectParticipants(json))
            participants.add(name);
        const before = allShares.length;
        collectSharesFromMessages(json, allShares, fileRejected, f.name, participants);
        const added = allShares.length - before;
        by_file.push({
            file_name: f.name,
            shares_added: added,
            rejected_count: fileRejected.length,
            rejected_samples: fileRejected.slice(0, 200),
            participants_detected: Array.from(participants)
                .filter(Boolean)
                .slice(0, 60),
        });
        allRejected.push(...fileRejected);
    }
    const seen = new Set();
    const out = [];
    for (const s of allShares) {
        const key = `${s.sender_name}::${s.url}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(s);
    }
    return { shares: out, rejected: allRejected, by_file };
}
