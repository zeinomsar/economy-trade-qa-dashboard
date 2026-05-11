import fs from "fs";
import path from "path";
import { readExcelRecords } from "../lib/excel.js";

const projectRoot = process.cwd();
const inputPath = process.argv[2]
  ? path.resolve(projectRoot, process.argv[2])
  : path.join(projectRoot, "data", "Economy and trade.xlsx");
const outputPath = process.argv[3]
  ? path.resolve(projectRoot, process.argv[3])
  : path.join(projectRoot, "data", "economy_and_trade_services.json");

const records = await readExcelRecords(inputPath);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");

console.log(`Converted ${records.length} records`);
console.log(`Input:  ${inputPath}`);
console.log(`Output: ${outputPath}`);
