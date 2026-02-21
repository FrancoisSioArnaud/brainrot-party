import React, { useEffect, useMemo, useRef, useState } from "react";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";

export default function MasterGame() {
  const clientRef = useRef<LobbyClient | null>(null);
  const [state, setState] = useState<LobbyState | null>(null);

  useEffect(() => {
    const c = new LobbyClient();
    clientRef.current = c;

    c.onState((s) => setState(s));

    c.connectAsMaster().catch(() => {});

    return () => {
      c.close();
    };
  }, []);

  const openReel = async () => {
    try {
      await clientRef.current?.openReel();
    } catch {}
  };

  if (!state) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Master Game</h1>

      <button onClick={openReel}>
        Ouvrir le reel courant
      </button>

      <pre style={{ marginTop: 24 }}>
        {JSON.stringify(state, null, 2)}
      </pre>
    </div>
  );
}
