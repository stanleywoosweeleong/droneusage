/* Dosage math regression test — no dependencies.
 *
 *   node test/dose.test.js
 *
 * Reads the calculation core straight out of ../index.html, so it always
 * tests the shipped code rather than a copy that can drift. If you rename
 * the "number helpers" or "rendering" banner comments in index.html, update
 * the two markers below.
 */
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '..', 'index.html');
const START = '/* ===================== number helpers';
const END = '/* ===================== rendering';

const src = fs.readFileSync(HTML, 'utf8');
if (src.indexOf(START) < 0 || src.indexOf(END) < 0) {
  console.error('Could not locate the calculation core in index.html.');
  console.error('Expected the banner comments:\n  ' + START + '\n  ' + END);
  process.exit(2);
}
const core = src.slice(src.indexOf(START), src.indexOf(END));

/* Stub only what the core touches: state and the translation lookup.
   Error strings are replaced with stable codes so the test does not
   depend on wording in any of the three languages. */
const prelude = `
var S = null;
function t(k){ return {errArea:"ERR_AREA",errRate:"ERR_RATE",errTank:"ERR_TANK",
  errConv:"ERR_CONV",errDose:"ERR_DOSE {name}",prodName:"Product",unnamed:"Product",
  warnHighConc:"HIGH_CONC",warnRatioConversion:"RATIO_CONVERSION",warnVolume:"VOL {p}",warnPartial:"PARTIAL {v}"}[k] || k; }
function fill(s,o){ var k; for(k in o){ s=s.split("{"+k+"}").join(o[k]); } return s; }
`;

const API = new Function(prelude + core +
  '\nreturn {compute:compute, fmt:fmt, amount:amount, num:num, setS:function(x){S=x;}};')();
const compute = API.compute, amount = API.amount, setS = API.setS;

let pass = 0, fail = 0;
function check(label, got, want, tol) {
  const ok = tol === undefined ? got === want : Math.abs(got - want) < tol;
  if (ok) { pass++; }
  else { fail++; console.log(`  FAIL  ${label}\n        got ${got}, want ${want}`); }
}
function group(name) { console.log('\n' + name); }

/* Baseline: T50 (40 L), 5 acres at 20 L/acre, 500 mL/acre of one product. */
const base = {
  model: "T50", tank: 40, areaUnit: "ac", area: 5,
  rate: 20, conv: 800, split: "even",
  products: [{ name: "Metalaxyl", basis: "area", unit: "ml", dose: "500", labelTank: 16, ratio: "" }]
};
const S2 = (o) => setS(Object.assign(JSON.parse(JSON.stringify(base)), o));
let r;

group('1. Per-acre dosing');
S2({}); r = compute();
check('total spray volume', r.total, 100, 1e-9);
check('load count', r.n, 3);
check('even load size', r.loads[0], 100 / 3, 1e-9);
check('product total', r.totals[0].base, 2500, 1e-9);
check('product per load', r.rows[0].chem[0].base, 2500 / 3, 1e-9);
check('water per load', r.rows[0].water, 100 / 3 - (2500 / 3) / 1000, 1e-9);
check('concentration mL/L', r.totals[0].perL, 25, 1e-9);
check('concentration %', r.totals[0].pct, 2.5, 1e-9);
check('multiplier vs conventional', r.mult, 40, 1e-9);

group('2. Conservation of mass — even split');
check('loads sum to total volume', r.loads.reduce((a, b) => a + b, 0), 100, 1e-9);
check('per-load product sums to total', r.rows.reduce((a, x) => a + x.chem[0].base, 0), 2500, 1e-9);

group('3. Conservation of mass — full + remainder');
S2({ split: "full" }); r = compute();
check('load count', r.n, 3);
check('first load is full', r.loads[0], 40, 1e-9);
check('last load is remainder', r.loads[2], 20, 1e-9);
check('loads sum to total volume', r.loads.reduce((a, b) => a + b, 0), 100, 1e-9);
check('product in full load', r.rows[0].chem[0].base, 1000, 1e-9);
check('product in remainder', r.rows[2].chem[0].base, 500, 1e-9);
check('per-load product sums to total', r.rows.reduce((a, x) => a + x.chem[0].base, 0), 2500, 1e-9);
check('partial-load notice raised', r.warnings.some(w => w.text.startsWith('PARTIAL')), true);

group('4. Knapsack label converted to drone dose — the reason this app exists');
/* Label: 20 mL per 16 L = 1.25 mL/L. Conventional 800 L/acre -> 1000 mL/acre.
   Copying 1.25 mL/L straight into a 20 L/acre drone would deliver 25 mL/acre,
   i.e. 2.5% of the intended dose. The conversion must prevent that. */
S2({ products: [{ name: "Label", basis: "tank", unit: "ml", dose: "20", labelTank: 16, ratio: "" }] });
r = compute();
check('derived rate per acre', r.totals[0].base / r.acres, 1000, 1e-9);
check('total for 5 acres', r.totals[0].base, 5000, 1e-9);
check('drone tank concentration', r.totals[0].perL, 50, 1e-9);
check('multiplier reported', r.mult, 40, 1e-9);

group('5. Dilution ratio basis');
S2({ products: [{ name: "Ratio", basis: "ratio", unit: "ml", dose: "", labelTank: 16, ratio: "800" }] });
r = compute();
check('1:800 at 800 L/acre = 1000 mL/acre', r.totals[0].base / r.acres, 1000, 1e-9);
check('ratio products are liquid', r.totals[0].liquid, true);
check('ratio conversion warning is shown', r.warnings.some(w => w.text === 'RATIO_CONVERSION'), true);

group('6. Area unit conversions');
S2({ areaUnit: "ha", area: 2 }); r = compute();
check('2 ha to acres', r.acres, 4.942108, 1e-6);

group('7. Solids');
S2({ products: [{ name: "WP", basis: "area", unit: "g", dose: "300", labelTank: 16, ratio: "" }] });
r = compute();
check('total grams', r.totals[0].base, 1500, 1e-9);
check('rolls over to kg for display', amount(r.totals[0].base, false), "1.5 kg");
check('solids do not displace water', r.rows[0].water, r.rows[0].L, 1e-9);

group('8. Guard rails — must refuse rather than guess');
S2({ area: 0 });  check('zero area blocks output', compute().ok, false);
S2({ rate: 0 });  check('zero spray volume blocks output', compute().ok, false);
S2({ tank: 0 });  check('zero tank blocks output', compute().ok, false);
S2({ conv: 0, products: [{ name: "L", basis: "tank", unit: "ml", dose: "20", labelTank: 16, ratio: "" }] });
check('label basis without conventional volume is flagged',
  compute().errors.includes("ERR_CONV"), true);
S2({ products: [{ name: "", basis: "area", unit: "ml", dose: "", labelTank: 16, ratio: "" }] });
check('untouched product raises no noise', compute().errors.length, 0);

group('9. Safety warnings');
S2({ rate: 6, products: [{ name: "Strong", basis: "area", unit: "ml", dose: "5000", labelTank: 16, ratio: "" }] });
r = compute();
check('concentration percent', r.totals[0].pct, 83.3333, 0.01);
check('high-concentration warning', r.warnings.some(w => w.text === 'HIGH_CONC'), true);
check('product-volume warning', r.warnings.some(w => w.text.startsWith('VOL')), true);

group('10. Tank mix of several products');
S2({
  products: [
    { name: "A", basis: "area", unit: "ml", dose: "500", labelTank: 16, ratio: "" },
    { name: "B", basis: "area", unit: "l", dose: "1", labelTank: 16, ratio: "" },
    { name: "C", basis: "area", unit: "g", dose: "200", labelTank: 16, ratio: "" }
  ]
});
r = compute();
check('all three carried', r.items.length, 3);
const liq = r.rows[0].chem.filter(c => c.liquid).reduce((a, c) => a + c.base, 0);
check('water accounts for every liquid', r.rows[0].water, r.rows[0].L - liq / 1000, 1e-9);
check('litre input totals correctly', amount(r.totals[1].base, true), "5 L");

group('11. Load-count edges');
S2({ area: 1, rate: 20, tank: 40 }); r = compute();
check('part tank is one load', r.n, 1);
S2({ area: 2, rate: 20, tank: 40 }); r = compute();
check('exactly one tankful does not become two', r.n, 1);
S2({ area: 2.0001, rate: 20, tank: 40 }); r = compute();
check('a hair over one tankful becomes two', r.n, 2);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
