import { REF_PLAYER, simulateMatch, stageAi, targetAccuracy, uniformUpgrades, type SimPlayer } from '../src/index.js';

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

const N = Number(process.argv[2] ?? 1000);
const avg: SimPlayer = { secPerQuestion: 4, accuracy: 0.7 };

console.log(`== avg vs avg, ${N} matches ==`);
const rs = Array.from({ length: N }, (_, i) => simulateMatch(avg, avg, i + 1));
const qs = rs.map((r) => r.questions.left);
const secs = rs.map((r) => r.seconds);
console.log(`questions  p10=${pct(qs, 0.1)} p50=${pct(qs, 0.5)} p90=${pct(qs, 0.9)}`);
console.log(`seconds    p10=${pct(secs, 0.1).toFixed(0)} p50=${pct(secs, 0.5).toFixed(0)} p90=${pct(secs, 0.9).toFixed(0)}`);
console.log(`left win   ${(rs.filter((r) => r.winner === 'left').length / N * 100).toFixed(1)}%  no-winner ${rs.filter((r) => !r.winner).length}`);

console.log(`\n== stage curve (avg player, 200 matches each) ==`);
// the standard: a reader at the stage's target accuracy, plus one 10 points below and one 10 above
for (const id of [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
  const st = { id, name: String(id), ai: stageAi(id) };
  const lvl = Math.min(10, Math.round(id / 10));
  const acc = targetAccuracy(id);
  const players: SimPlayer[] = [acc - 0.1, acc, acc + 0.1].map((a) => ({ secPerQuestion: REF_PLAYER.secPerQuestion, accuracy: Math.max(0.05, Math.min(0.99, a)), strategy: id < 20 ? ['tank', 'archer'] : undefined }));
  const row = players.map((p0) => {
    const p = { ...p0, upgrades: uniformUpgrades(lvl) };
    const r = Array.from({ length: 200 }, (_, i) => simulateMatch(p, st.ai, i + 1));
    const win = r.filter((x) => x.winner === 'left').length / 2;
    const q = pct(r.map((x) => x.questions.left), 0.5);
    return `${win.toFixed(0).padStart(3)}% (${q}q)`;
  });
  console.log(`stage ${String(st.id).padStart(3)} lv${lvl} target ${Math.round(acc * 100)}%  -10% ${row[0]}  on-target ${row[1]}  +10% ${row[2]}`);
}
