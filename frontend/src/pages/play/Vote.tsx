import React, { useMemo, useState } from "react";
import { useGameStore } from "../../store/gameStore";
import VoteGrid from "../../components/play/game/VoteGrid";
import VoteFooter from "../../components/play/game/VoteFooter";
import { toast } from "../../components/common/Toast";
import { GameClient } from "../../ws/gameClient";

export default function VotePage({ client, auth }: { client: GameClient | null; auth: { player_id: string; token: string } | null }) {
  const senders = useGameStore(s => s.senders);
  const items = useGameStore(s => s.items);
  const focus_item_id = useGameStore(s => s.focus_item_id);

  const focus = useMemo(() => items.find(i => i.id === focus_item_id) || null, [items, focus_item_id]);
  const k = focus?.k || 1;

  const [sel, setSel] = useState<string[]>([]);

  function toggle(id: string) {
    setSel((cur) => {
      const has = cur.includes(id);
      if (has) return cur.filter(x => x !== id);
      if (cur.length >= k) return cur; // max k
      return [...cur, id];
    });
  }

  return (
    <div>
      <h1 style={{ margin: "10px 0" }}>{k} users à sélectionner</h1>
      <VoteGrid senders={senders.filter(s => s.active)} selected={sel} onToggle={toggle} />
      <VoteFooter
        selectedCount={sel.length}
        k={k}
        onSubmit={() => {
          if (!auth || !client || !focus_item_id) return;
          if (sel.length < k) {
            toast(`Sélectionne encore ${k - sel.length}`);
            return;
          }
          client.castVote(auth.player_id, auth.token, focus_item_id, sel);
          toast("Vote envoyé");
        }}
      />
    </div>
  );
}
