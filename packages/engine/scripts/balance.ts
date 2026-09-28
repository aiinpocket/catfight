import { simulateMatch, stageAi, type SimPlayer } from '../src/index.js';

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
const weak: SimPlayer = { secPerQuestion: 6, accuracy: 0.55, strategy: ['tank', 'archer'] };
const strong: SimPlayer = { secPerQuestion: 3, accuracy: 0.85 };
for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15]) {
  const st = { id, name: String(id), ai: stageAi(id) };
  const row = [weak, avg, strong].map((p) => {
    const r = Array.from({ length: 200 }, (_, i) => simulateMatch(p, st.ai, i + 1));
    const win = r.filter((x) => x.winner === 'left').length / 2;
    const q = pct(r.map((x) => x.questions.left), 0.5);
    return `${win.toFixed(0).padStart(3)}% (${q}q)`;
  });
  console.log(`stage ${st.id} ${st.name.padEnd(6)} weak ${row[0]}  avg ${row[1]}  strong ${row[2]}`);
}
