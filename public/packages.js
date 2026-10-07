// Single source of truth for the lighting packages — loaded by both the customer app (app.js)
// and the internal sales tool (/team), so the two can never drift apart.
const PACKAGES = [
  {
    key: "package1",
    name: "Cousin Eddie Package",
    subtitle: null,
    features: ["Roofline"],
    heroImage: "package-hero-1.jpg",
  },
  {
    key: "package2",
    name: "Buddy the Elf",
    subtitle: "Most Popular",
    popular: true,
    features: ["Roofline", "Wreath"],
    heroImage: "package-hero-2.jpg",
  },
  {
    key: "package3",
    name: "Santa's Favorite",
    subtitle: null,
    features: ["Roofline", "Wreath", "Trees and Shrubs"],
    heroImage: "package-hero-3.jpg",
  },
  {
    key: "package4",
    name: "Clark Griswold Package",
    subtitle: null,
    features: ["Roofline", "Wreath", "Trees and Shrubs", "Driveway Stake Lighting", "Sidewalk Stake Lighting"],
    heroImage: "package-hero-4.jpg",
  },
];

const DEFAULT_PACKAGE_HERO_IMAGE = "package-hero-4.jpg";

const FEATURE_LEGEND = {
  Roofline: { number: 1, color: "#86b83e" },
  Wreath: { number: 2, color: "#e58909" },
  "Trees and Shrubs": { number: 3, color: "#663798" },
  "Driveway Stake Lighting": { number: 4, color: "#cd1513" },
  "Sidewalk Stake Lighting": { number: 5, color: "#d99638" },
};
