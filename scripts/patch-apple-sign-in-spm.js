const fs = require("fs");
const path = require("path");

const packageSwiftPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "@capacitor-community",
  "apple-sign-in",
  "Package.swift"
);

if (!fs.existsSync(packageSwiftPath)) {
  console.warn("[FloMind] Apple Sign In plugin Package.swift not found, skipping SPM patch.");
  process.exit(0);
}

const source = fs.readFileSync(packageSwiftPath, "utf8");
const capacitor7Requirement = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")';
const capacitor8Requirement = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")';

if (source.includes(capacitor8Requirement)) {
  console.log("[FloMind] Apple Sign In SPM patch already applied.");
  process.exit(0);
}

if (!source.includes(capacitor7Requirement)) {
  console.warn("[FloMind] Apple Sign In SPM dependency shape changed, patch not applied.");
  process.exit(0);
}

fs.writeFileSync(packageSwiftPath, source.replace(capacitor7Requirement, capacitor8Requirement));
console.log("[FloMind] Apple Sign In SPM dependency patched for Capacitor 8.");
