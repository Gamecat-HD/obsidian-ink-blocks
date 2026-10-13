/**
 * Umriss-Polygon (perfect-freehand `getStroke`) → SVG-Pfad mit quadratischen Kurven.
 * Nach dem Helper aus der perfect-freehand-README (MIT, © Steve Ruiz).
 */
export function svgPathFromOutline(points: number[][], closed = true): string {
	const len = points.length;
	if (len < 4) return "";
	const avg = (a: number, b: number) => (a + b) / 2;
	let a = points[0];
	let b = points[1];
	const c = points[2];
	let result =
		`M${a[0].toFixed(2)},${a[1].toFixed(2)} ` +
		`Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;
	for (let i = 2, max = len - 1; i < max; i++) {
		a = points[i];
		b = points[i + 1];
		result += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
	}
	if (closed) result += "Z";
	return result;
}
