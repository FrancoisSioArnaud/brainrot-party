// SEULEMENT les parties modifiées importantes

// ajouter :
const [currentReelUrl, setCurrentReelUrl] = useState<string | null>(null);

// dans onMsg :

if (m.type === "NEW_ITEM") {
  setCurrentRoundId(m.payload.round_id);
  setCurrentItemId(m.payload.item_id);
  setCurrentReelUrl(m.payload.reel_url);
  setVotedSet(new Set());
  setLastResults(null);
  setLastRecapRoundId(null);
  return;
}

// dans le JSX, ajouter au dessus des contrôles :

{phase === "game" && currentReelUrl ? (
  <div className="card" style={{ marginTop: 12 }}>
    <div className="h2">Reel</div>
    <div style={{ marginTop: 10 }}>
      <iframe
        src={currentReelUrl}
        style={{ width: "100%", height: 500, border: "none" }}
        allow="autoplay; encrypted-media"
      />
    </div>
  </div>
) : null}
