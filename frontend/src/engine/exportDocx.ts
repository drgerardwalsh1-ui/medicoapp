import { saveAs } from "file-saver";
import { Document, Packer, Paragraph } from "docx";
import { buildDocument } from "./documentEngine";
import { formatFullName, type Client } from "../types/client";

export async function exportReportToDocx(client: Client, _title: string) {
  const report = client.report ?? {};
  const identity = client.identity;
  const inj = client.clinical?.injury;

  const name = formatFullName(identity);
  const header = [
    `Name: ${name}`,
    `DOB: ${identity?.dateOfBirth ?? ""}`,
    `Claim: ${inj?.claimNumber ?? ""}`,
    `Insurer: ${inj?.insurerName ?? ""}`,
  ].join("\n");

  const text = header + "\n\n" + buildDocument(report.fields ?? {});

  const doc = new Document({
    sections: [
      {
        children: text.split("\n").map(
          (line) => new Paragraph({ text: line })
        ),
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const slug = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "client";
  saveAs(blob, `${slug}.docx`);
}
