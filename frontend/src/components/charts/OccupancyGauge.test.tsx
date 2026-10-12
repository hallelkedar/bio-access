import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { arcPercent, OccupancyGauge } from "./OccupancyGauge";

describe("OccupancyGauge", () => {
  it("arc share is clamped and never divides by zero", () => {
    expect(arcPercent(15, 100)).toBe(15);
    expect(arcPercent(150, 100)).toBe(100);
    expect(arcPercent(5, 0)).toBe(0);
    expect(arcPercent(0, 100)).toBe(0);
  });

  it("is a labelled meter with the percent in the middle", () => {
    render(<OccupancyGauge entered={15} sold={40} capacity={100} />);

    const meter = screen.getByRole("meter", { name: "Occupancy" });
    expect(meter).toHaveAttribute("aria-valuenow", "15");
    expect(meter).toHaveAttribute("aria-valuetext", "15 / 100 inside");
    expect(meter).toHaveTextContent("15%");
  });

  it("shows a dash without capacity", () => {
    render(<OccupancyGauge entered={3} sold={0} capacity={0} />);

    expect(screen.getByRole("meter")).toHaveTextContent("—");
    expect(screen.getByText("3 inside (no capacity set)")).toBeInTheDocument();
  });
});
