import { describe, expect, it } from "vitest";
import { MultiTouch } from "./MultiTouch";

describe("Mehrfinger-Gesten", () => {
	it("Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen", () => {
		const m = new MultiTouch();
		m.down(1, 100, 100, 0);
		expect(m.down(2, 200, 100, 30)).toBe(2);
		expect(m.up(1, 120)).toBeNull();
		expect(m.up(2, 150)).toBe("undo");

		m.down(1, 100, 100, 1000);
		m.down(2, 150, 100, 1010);
		m.down(3, 200, 100, 1020);
		m.up(3, 1100);
		m.up(1, 1110);
		expect(m.up(2, 1120)).toBe("redo");
	});

	it("ein Finger, zu lang gehalten oder bewegt: keine Aktion", () => {
		const m = new MultiTouch();
		m.down(1, 0, 0, 0);
		expect(m.up(1, 50)).toBeNull();

		m.down(1, 0, 0, 0);
		m.down(2, 50, 0, 10);
		m.up(1, 600);
		expect(m.up(2, 610)).toBeNull();

		m.down(1, 0, 0, 1000);
		m.down(2, 50, 0, 1010);
		m.move(2, 80, 0);
		m.up(1, 1100);
		expect(m.up(2, 1110)).toBeNull();
	});

	it("Pinch: Abstand relativ zum Beginn, Mitte zwischen den Fingern", () => {
		const m = new MultiTouch();
		m.down(1, 100, 100, 0);
		m.down(2, 200, 100, 0);
		expect(m.move(2, 200, 100)).toEqual({ scale: 1, cx: 150, cy: 100 });
		expect(m.move(2, 300, 100)).toEqual({ scale: 2, cx: 200, cy: 100 });
		m.down(3, 0, 0, 0);
		expect(m.move(3, 5, 5)).toBeNull();
	});

	it("unbekannte Finger werden ignoriert", () => {
		const m = new MultiTouch();
		expect(m.up(9, 0)).toBeNull();
		expect(m.move(9, 0, 0)).toBeNull();
	});
});
