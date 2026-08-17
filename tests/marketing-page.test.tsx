// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommercialHeader, CommercialMarketingPage } from "../apps/web/src/marketing";

afterEach(cleanup);

describe("SiftCut commercial landing page", () => {
  it("presents the beta conversion and invited-member path", () => {
    render(<><CommercialHeader authEnabled={false} /><CommercialMarketingPage /></>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Find the short hiding inside the long story.");
    expect(screen.getAllByRole("link", { name: "Request beta access" })[0]).toHaveAttribute("href", "#beta-access");
    expect(screen.getByRole("link", { name: "Invited member sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("distinguishes all products and status labels without false acceptance", () => {
    render(<CommercialMarketingPage />);
    for (const name of ["SiftCut Desktop", "SiftCut Cloud", "SiftCut Mobile"]) expect(screen.getByText(name)).toBeVisible();
    expect(screen.getByText("Available in Desktop")).toBeVisible();
    expect(screen.getByText("Cloud private-beta work")).toBeVisible();
    expect(screen.getByText("Mobile roadmap")).toBeVisible();
    expect(screen.getByText(/has not yet passed staging acceptance/)).toBeVisible();
    expect(screen.getByLabelText("Illustrative SiftCut Cloud product preview")).toBeVisible();
  });

  it("uses labeled form controls and required consent", () => {
    render(<CommercialMarketingPage />);
    expect(screen.getByLabelText("Your name")).toBeRequired();
    expect(screen.getByLabelText("Work email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText(/I agree that SiftCut/)).toBeRequired();
    expect(screen.getByRole("button", { name: "Request beta access" })).toBeVisible();
    fireEvent.submit(screen.getByRole("button", { name: "Request beta access" }).closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Complete the required fields");
  });
});
