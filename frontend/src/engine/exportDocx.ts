import { saveAs } from "file-saver";
import { Document, Packer, Paragraph } from "docx";
import { buildDocument } from "./documentEngine";

export async function exportReportToDocx(client: any, _title: string) {

  const report = client.report || {};
  const d = client.demographics || {};

  const header = `
Name: ${d.forename || ""} ${d.surname || ""}
DOB: ${d.dob || ""}
Claim: ${d.claim || ""}
Insurer: ${d.insurer || ""}
`;

  const text = header + "\n\n" + buildDocument(report);

  const doc = new Document({
    sections: [
      {
        children: text.split("\n").map(
          (line) => new Paragraph({ text: line })
        )
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${client.name}.docx`);
}