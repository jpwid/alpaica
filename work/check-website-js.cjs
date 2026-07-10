const fs = require("fs");

const html = fs.readFileSync("outputs/index.html", "utf8");
const external = fs.readFileSync("outputs/europe-cities.js", "utf8");

new Function(external);

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
for (const script of scripts) {
  new Function(script);
}

console.log("Website JavaScript is geldig");
