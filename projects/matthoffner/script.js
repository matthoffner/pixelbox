const taglines = [
  "Things I keep thinking about building.",
  "Software ideas I keep circling back to.",
  "Projects I keep making time for.",
  "A running list of things I want to exist.",
  "Things I keep prototyping in my head.",
  "A few systems I can't stop thinking about.",
  "Software experiments worth keeping around.",
  "Stuff I'm building when I get the chance.",
  "Ideas that keep surviving first contact with reality.",
  "A home for the projects I keep returning to.",
  "Three projects, still not over any of them.",
  "Software for the parts of work that still feel clumsy.",
  "A few things I think should be easier to build.",
  "Projects for when the current tools feel slightly wrong.",
  "Things I want on my computer badly enough to make.",
  "A small collection of software obsessions.",
  "What I've been building instead of letting the idea go.",
  "Projects for making the work feel less scattered.",
  "Software ideas with enough pull to keep going.",
  "Things I keep rebuilding because I still want them.",
  "A few tools I wish already existed.",
  "Projects that started as annoyances and stuck around.",
  "Things I'm building because the workflow still bugs me.",
  "A personal index of software I care about.",
  "Experiments I keep wanting to push further."
];

const phaseConfig = {
  lateNight: {
    bg: "#04070f",
    bg2: "#0a1320",
    bg3: "#132239",
    fontBody: "\"Avenir Next\", \"Inter\", \"Segoe UI\", sans-serif",
    fontHeading: "\"Avenir Next\", \"Inter\", \"Segoe UI\", sans-serif",
    fontKicker: "\"Courier New\", monospace",
    headingWeight: "680",
    headingSpacing: "-0.04em",
    bodyWeight: "430",
    bodySpacing: "-0.004em",
    text: "#eef4ff",
    muted: "#aabed7",
    mutedStrong: "rgba(238, 244, 255, 0.88)",
    surfaceText: "#f4f7fb",
    surfaceMuted: "#d2ddeb",
    field1: "rgba(125, 184, 255, 0.12)",
    field2: "rgba(164, 255, 241, 0.05)",
    field3: "rgba(200, 212, 255, 0.06)",
    auroraLeft: "rgba(136, 184, 255, 0.14)",
    auroraRight: "rgba(164, 255, 241, 0.08)"
  },
  dawn: {
    bg: "#1a1d32",
    bg2: "#4a3851",
    bg3: "#d89060",
    fontBody: "\"Avenir Next\", \"Inter\", \"Segoe UI\", sans-serif",
    fontHeading: "\"Avenir Next\", \"Inter\", \"Segoe UI\", sans-serif",
    fontKicker: "\"Courier New\", monospace",
    headingWeight: "700",
    headingSpacing: "-0.045em",
    bodyWeight: "440",
    bodySpacing: "-0.006em",
    text: "#fff6f1",
    muted: "#f0ddd5",
    mutedStrong: "rgba(255, 246, 241, 0.9)",
    surfaceText: "#fff8f3",
    surfaceMuted: "#f3dfd4",
    field1: "rgba(255, 187, 133, 0.16)",
    field2: "rgba(167, 242, 255, 0.08)",
    field3: "rgba(255, 158, 181, 0.08)",
    auroraLeft: "rgba(255, 191, 137, 0.16)",
    auroraRight: "rgba(167, 242, 255, 0.1)"
  },
  day: {
    bg: "#5c93c3",
    bg2: "#8ec4eb",
    bg3: "#d5edf7",
    fontBody: "\"Segoe UI\", \"Inter\", sans-serif",
    fontHeading: "\"Segoe UI\", \"Inter\", sans-serif",
    fontKicker: "\"SFMono-Regular\", \"Courier New\", monospace",
    headingWeight: "760",
    headingSpacing: "-0.05em",
    bodyWeight: "500",
    bodySpacing: "-0.01em",
    text: "#10283b",
    muted: "#27455c",
    mutedStrong: "rgba(16, 40, 59, 0.88)",
    surfaceText: "#eff6fb",
    surfaceMuted: "#d9e4ee",
    field1: "rgba(255, 246, 202, 0.16)",
    field2: "rgba(152, 255, 217, 0.08)",
    field3: "rgba(138, 215, 255, 0.1)",
    auroraLeft: "rgba(152, 255, 217, 0.12)",
    auroraRight: "rgba(138, 215, 255, 0.12)"
  },
  golden: {
    bg: "#503042",
    bg2: "#c27159",
    bg3: "#f0b972",
    fontBody: "\"Avenir Next\", \"Inter\", \"Segoe UI\", sans-serif",
    fontHeading: "\"Avenir Next\", \"Inter\", \"Segoe UI\", sans-serif",
    fontKicker: "\"SFMono-Regular\", \"Courier New\", monospace",
    headingWeight: "720",
    headingSpacing: "-0.048em",
    bodyWeight: "470",
    bodySpacing: "-0.007em",
    text: "#2c160e",
    muted: "#533127",
    mutedStrong: "rgba(44, 22, 14, 0.88)",
    surfaceText: "#fff4eb",
    surfaceMuted: "#f3dac8",
    field1: "rgba(255, 188, 102, 0.18)",
    field2: "rgba(255, 240, 176, 0.07)",
    field3: "rgba(255, 159, 134, 0.08)",
    auroraLeft: "rgba(255, 185, 101, 0.16)",
    auroraRight: "rgba(255, 240, 176, 0.08)"
  },
  dusk: {
    bg: "#181a35",
    bg2: "#3d3f73",
    bg3: "#d07a72",
    fontBody: "\"Inter\", \"Avenir Next\", \"Segoe UI\", sans-serif",
    fontHeading: "\"Inter\", \"Avenir Next\", \"Segoe UI\", sans-serif",
    fontKicker: "\"Courier New\", monospace",
    headingWeight: "700",
    headingSpacing: "-0.046em",
    bodyWeight: "450",
    bodySpacing: "-0.006em",
    text: "#fff1f1",
    muted: "#efd6d7",
    mutedStrong: "rgba(255, 241, 241, 0.9)",
    surfaceText: "#fff3f3",
    surfaceMuted: "#f1dcde",
    field1: "rgba(180, 196, 255, 0.12)",
    field2: "rgba(255, 177, 194, 0.08)",
    field3: "rgba(255, 177, 108, 0.07)",
    auroraLeft: "rgba(180, 196, 255, 0.14)",
    auroraRight: "rgba(255, 177, 194, 0.08)"
  }
};

function getPhaseKey(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < 300) return "lateNight";
  if (minutes < 480) return "dawn";
  if (minutes < 1020) return "day";
  if (minutes < 1140) return "golden";
  if (minutes < 1260) return "dusk";
  return "lateNight";
}

function applyPhaseTheme(date = new Date()) {
  const phase = phaseConfig[getPhaseKey(date)];
  if (!phase) return;

  const root = document.documentElement;
  root.style.setProperty("--bg", phase.bg);
  root.style.setProperty("--bg-2", phase.bg2);
  root.style.setProperty("--bg-3", phase.bg3);
  root.style.setProperty("--font-body", phase.fontBody);
  root.style.setProperty("--font-heading", phase.fontHeading);
  root.style.setProperty("--font-kicker", phase.fontKicker);
  root.style.setProperty("--heading-weight", phase.headingWeight);
  root.style.setProperty("--heading-spacing", phase.headingSpacing);
  root.style.setProperty("--body-weight", phase.bodyWeight);
  root.style.setProperty("--body-spacing", phase.bodySpacing);
  root.style.setProperty("--text", phase.text);
  root.style.setProperty("--muted", phase.muted);
  root.style.setProperty("--muted-strong", phase.mutedStrong);
  root.style.setProperty("--surface-text", phase.surfaceText);
  root.style.setProperty("--surface-muted", phase.surfaceMuted);
  root.style.setProperty("--field-1", phase.field1);
  root.style.setProperty("--field-2", phase.field2);
  root.style.setProperty("--field-3", phase.field3);
  root.style.setProperty("--aurora-left", phase.auroraLeft);
  root.style.setProperty("--aurora-right", phase.auroraRight);
}

const taglineElement = document.querySelector("#random-tagline");
if (taglineElement) {
  const index = Math.floor(Math.random() * taglines.length);
  taglineElement.textContent = taglines[index];
}

applyPhaseTheme();
window.setInterval(() => applyPhaseTheme(), 60_000);

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      }
    }
  },
  {
    threshold: 0.2
  }
);

for (const element of document.querySelectorAll(".reveal")) {
  observer.observe(element);
}
