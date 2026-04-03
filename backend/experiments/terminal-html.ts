import "dotenv/config";

async function main() {
  const url = "https://52b74f98fab0c28f3459559533e2603f.preview.bl.run/terminal?token=" + process.env.BL_API_KEY;
  const res = await fetch(url);
  const html = await res.text();
  console.log(html);
}

main();
