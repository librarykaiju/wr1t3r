import { test } from "node:test";
import assert from "node:assert/strict";
import { rtfToMarkdown } from "../src/rtf.js";
import { readScrivener, parseXml } from "../src/scrivenerimport.js";
import { binderOrder, cardInfo } from "../src/binder.js";
import { leftOut } from "../src/compile.js";

// RTF written with | for each backslash, so the fixtures stay readable.
const rtf = (s) => s.replace(/\|/g, "\\");
const md = (s, opts) => rtfToMarkdown(rtf(s), opts).text;

// ---- RTF ----

test("RTF: paragraphs, quotes and dashes from Scrivener on a Mac", () => {
	const doc = rtf(`{|rtf1|ansi|ansicpg1252|cocoartf2639
{|fonttbl|f0|fnil|fcharset0 Palatino-Roman;}
{|colortbl;|red255|green255|blue255;}
{|*|expandedcolortbl;;}
|pard|tx360|fi360|sl264|slmult1|pardirnatural|partightenfactor0

|f0|fs26 |cf0 She said |'93hello|'94 and |uc0|u8212  left.|
|tab Second paragraph.}`);
	assert.equal(rtfToMarkdown(doc).text, "She said “hello” and — left.\n\nSecond paragraph.");
});

test("RTF: bold, italic and strikethrough, marks kept off the spaces", () => {
	assert.equal(md("{|rtf1 Plain |i italic |i0 and|b  bold|b0 , |strike gone|strike0 .}"), "Plain *italic* and **bold**, ~~gone~~.");
	assert.equal(md("{|rtf1 {|b|i both} {|b bold |i then italic}}"), "***both* bold *then italic***");
});

test("RTF: markdown characters in the text are escaped, scene breaks kept", () => {
	assert.equal(md("{|rtf1 2 * 3 is [six] and snake_case _here_|par # not a heading|par - not a list|par * * *}"),
		"2 \\* 3 is \\[six\\] and snake_case \\_here\\_\n\n\\# not a heading\n\n\\- not a list\n\n* * *");
});

test("RTF: unicode with a fallback character, and \\uc", () => {
	assert.equal(md("{|rtf1 a|u8217?b |uc0|u8220 c|u8221 |uc2|u233 XYd}"), "a’b “c”éd");
});

test("RTF: links, line breaks, lists and the stylesheet's headings and quotes", () => {
	const doc = `{|rtf1|ansi{|stylesheet{|s0 Normal;}{|s1|b heading 2;}{|s2 Block Quote;}}
|pard|s1 Chapter One|par
|pard Visit {|field{|*|fldinst{HYPERLINK "https://example.com/"}}{|fldrslt |ul the site}} now,|line please.|par
|pard|ls1|ilvl0{|listtext	|u8226 	}one|par
{|listtext	|u8226 	}two|par
|pard|ls1|ilvl1{|listtext	|u8226 	}deeper|par
|pard{|pntext 1.|tab}first|par
|pard|s2 Quoted.|par}`;
	assert.equal(md(doc), "## Chapter One\n\nVisit [the site](<https://example.com/>) now,\\\nplease.\n\n- one\n- two\n   - deeper\n\n1. first\n\n> Quoted.");
});

test("RTF: footnotes, Scrivener 3 comments and linked footnotes", () => {
	const doc = "{|rtf1 One{|super|chftn}{|footnote|pard|plain {|super|chftn} The note.} two {|field{|*|fldinst{HYPERLINK \"scrivcmt://C1\"}}{|fldrslt marked}} three{|field{|*|fldinst{HYPERLINK \"scrivcmt://F1\"}}{|fldrslt }}.}";
	const comment = (id) => (id === "C1" ? { text: "Fix this\nlater" } : id === "F1" ? { text: "Linked.", footnote: true } : null);
	assert.equal(md(doc, { comment }), "One[^1] two {==marked==}{>>Fix this later<<} three[^2].\n\n[^1]: The note.\n[^2]: Linked.");
});

test("RTF: pictures, embedded and attached", () => {
	const seen = [];
	const image = (p) => { seen.push(p.file || `${p.ext}:${[...p.bytes].join(",")}`); return "![](pic)"; };
	const doc = `{|rtf1 A|par {|*|shppict{|pict|pngblip|picw1 89504e47}}{|nonshppict{|pict|wmetafile8 0102}}|par {{|NeXTGraphic Pasted Graphic.png |width100 |height100
}|'ac}|par B}`;
	assert.equal(md(doc, { image }), "A\n\n![](pic)\n\n![](pic)\n\nB");
	assert.deepEqual(seen, ["png:137,80,78,71", "Pasted Graphic.png"]);
	assert.deepEqual(rtfToMarkdown(rtf("{|rtf1 {|pict|wmetafile8 0102}}")).features, ["a picture in a format wr1t3r can't show (left out)"]);
});

test("RTF: what isn't text is left out", () => {
	assert.equal(md("{|rtf1{|info{|title Secret}}{|*|generator Word;}{|header Page}Body|bkmkstart x}"), "Body");
});

// ---- XML ----

test("XML tree: nesting, attributes, entities and CDATA", () => {
	const x = parseXml('<?xml version="1.0"?><A n="1"><B>x &amp; y</B><B><C/><![CDATA[<raw>]]></B></A>');
	assert.equal(x.name, "A");
	assert.equal(x.attrs.n, "1");
	assert.equal(x.children[0].text, "x & y");
	assert.equal(x.children[1].children[0].name, "C");
	assert.equal(x.children[1].text, "<raw>");
});

// ---- a Scrivener 3 project ----

const SCRIVX = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject Template="No" Version="2.0" Identifier="X">
  <Binder>
    <BinderItem UUID="D" Type="DraftFolder" Created="2024-01-01 10:00:00 -0500">
      <Title>Manuscript</Title>
      <Children>
        <BinderItem UUID="CH1" Type="Folder">
          <Title>Chapter 1</Title>
          <MetaData><IncludeInCompile>Yes</IncludeInCompile></MetaData>
          <Children>
            <BinderItem UUID="S1" Type="Text">
              <Title>The Road: North</Title>
              <MetaData>
                <LabelID>2</LabelID><StatusID>1</StatusID><IncludeInCompile>Yes</IncludeInCompile>
                <CustomMetaData><MetaDataItem><FieldID>pov</FieldID><Value>Anna</Value></MetaDataItem></CustomMetaData>
              </MetaData>
              <Keywords><KeywordID>0</KeywordID><KeywordID>1</KeywordID></Keywords>
            </BinderItem>
            <BinderItem UUID="S2" Type="Text">
              <Title>Cut scene</Title>
              <MetaData><IncludeInCompile>No</IncludeInCompile></MetaData>
            </BinderItem>
          </Children>
        </BinderItem>
        <BinderItem UUID="CH2" Type="Text">
          <Title>Chapter 2</Title>
          <Children>
            <BinderItem UUID="S3" Type="Text"><Title>Opening</Title></BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="R" Type="ResearchFolder">
      <Title>Research</Title>
      <Children>
        <BinderItem UUID="IMG" Type="Image"><Title>Map</Title></BinderItem>
        <BinderItem UUID="WEB" Type="WebArchive"><Title>A page</Title></BinderItem>
      </Children>
    </BinderItem>
    <BinderItem UUID="T" Type="TrashFolder">
      <Title>Trash</Title>
      <Children><BinderItem UUID="OLD" Type="Text"><Title>Old</Title></BinderItem></Children>
    </BinderItem>
  </Binder>
  <LabelSettings><Title>Label</Title><Labels>
    <Label ID="-1">No Label</Label><Label ID="1" Color="1 0 0">Concept</Label><Label ID="2" Color="0 0 1">Scene</Label>
  </Labels></LabelSettings>
  <StatusSettings><StatusItems><Status ID="-1">No Status</Status><Status ID="1">First Draft</Status></StatusItems></StatusSettings>
  <Keywords><Keyword ID="0"><Title>Anna</Title></Keyword><Keyword ID="1"><Title>road trip</Title></Keyword></Keywords>
  <CustomMetaDataSettings><MetaDataField Type="Text" ID="pov"><Title>POV</Title></MetaDataField></CustomMetaDataSettings>
</ScrivenerProject>`;

const project = {
	"The Long Winter.scriv/The Long Winter.scrivx": SCRIVX,
	"The Long Winter.scriv/Files/Data/S1/content.rtf": rtf("{|rtf1|ansi It was |i cold|i0  {|field{|*|fldinst{HYPERLINK \"scrivcmt://K\"}}{|fldrslt here}}.|par {{|NeXTGraphic road.png |width10 |height10\n}|'ac}}"),
	"The Long Winter.scriv/Files/Data/S1/road.png": "",
	"The Long Winter.scriv/Files/Data/S1/synopsis.txt": "Anna heads north.\n",
	"The Long Winter.scriv/Files/Data/S1/notes.rtf": rtf("{|rtf1 Check the map.}"),
	"The Long Winter.scriv/Files/Data/S1/content.comments": `<?xml version="1.0" encoding="UTF-8"?><Comments><Comment ID="K" Footnote="No"><![CDATA[${rtf("{|rtf1 Is it, though?}")}]]></Comment></Comments>`,
	"The Long Winter.scriv/Files/Data/S2/content.rtf": rtf("{|rtf1 Gone.}"),
	"The Long Winter.scriv/Files/Data/CH2/content.rtf": rtf("{|rtf1 Chapter two starts.}"),
	"The Long Winter.scriv/Files/Data/S3/content.rtf": rtf("{|rtf1 Morning.}"),
	"The Long Winter.scriv/Files/Data/IMG/content.jpg": "",
	"The Long Winter.scriv/Files/Data/WEB/content.webarchive": "",
	"The Long Winter.scriv/Files/Data/OLD/content.rtf": rtf("{|rtf1 Old.}"),
	"The Long Winter.scriv/Snapshots/S1.snapshots/x.rtf": "",
};

// The way src/main.js calls it: the .scriv folder's own name taken off the front.
function run(files) {
	const paths = Object.keys(files).map((p) => p.slice(p.indexOf("/") + 1));
	const name = Object.keys(files)[0].split("/")[0];
	return readScrivener(paths, (p) => files[name + "/" + p] ?? null, name);
}

test("Scrivener 3: the binder becomes folders and notes in order", () => {
	const r = run(project);
	assert.equal(r.name, "The Long Winter");
	const paths = r.notes.map((n) => n.path);
	assert.deepEqual(paths, [
		"Manuscript/Chapter 1/The Road- North.md",
		"Manuscript/Chapter 1/Cut scene.md",
		"Manuscript/Chapter 1/_Binder.md",
		"Manuscript/Chapter 2/Chapter 2.md",
		"Manuscript/Chapter 2/Opening.md",
		"Manuscript/Chapter 2/_Binder.md",
		"Manuscript/_Binder.md",
		"Research/Map.md",
		"Research/A page.md",
		"Research/_Binder.md",
		"_Binder.md",
	]);
	const text = (p) => r.notes.find((n) => n.path === p).text;
	// Each folder's binder keeps Scrivener's order.
	assert.deepEqual(binderOrder("Manuscript/", paths, text("Manuscript/_Binder.md")).map((x) => x.path), ["Manuscript/Chapter 1/", "Manuscript/Chapter 2/"]);
	assert.deepEqual(binderOrder("Manuscript/Chapter 2/", paths, text("Manuscript/Chapter 2/_Binder.md")).map((x) => x.path), ["Manuscript/Chapter 2/Chapter 2.md", "Manuscript/Chapter 2/Opening.md"]);
	assert.deepEqual(binderOrder("", paths, text("_Binder.md")).map((x) => x.path), ["Manuscript/", "Research/"]);
	assert.match(text("Manuscript/_Binder.md"), /^---\ncompile:\n  title: The Long Winter\n---\n/);
});

test("Scrivener 3: a document's text, properties, notes and comments", () => {
	const r = run(project);
	const text = (p) => r.notes.find((n) => n.path === p).text;
	const scene = text("Manuscript/Chapter 1/The Road- North.md");
	assert.equal(scene, [
		"---",
		'title: "The Road: North"',
		"synopsis: Anna heads north.",
		"label: 2",
		"label-name: Scene",
		"status: First Draft",
		"tags: [Anna, road trip]",
		"pov: Anna",
		"---",
		"It was *cold* {==here==}{>>Is it, though?<<}.",
		"",
		"![](<../../attachments/The Road- North 1.png>)",
		"",
		"%%",
		"Notes from Scrivener:",
		"",
		"Check the map.",
		"%%",
		"",
	].join("\n"));
	const card = cardInfo("Manuscript/Chapter 1/The Road- North.md", scene);
	assert.equal(card.title, "The Road: North");
	assert.equal(card.synopsis, "Anna heads north.");
	assert.equal(card.label, 2);
	assert.equal(card.status, "First Draft");
	assert.ok(leftOut(text("Manuscript/Chapter 1/Cut scene.md")));
	assert.ok(!leftOut(scene));
});

test("Scrivener 3: pictures, research files and what's left out", () => {
	const r = run(project);
	assert.deepEqual(r.files, [
		{ path: "attachments/The Road- North 1.png", from: "Files/Data/S1/road.png" },
		{ path: "attachments/Map.jpg", from: "Files/Data/IMG/content.jpg" },
	]);
	assert.equal(r.notes.find((n) => n.path === "Research/Map.md").text, "![Map](<../attachments/Map.jpg>)\n");
	assert.deepEqual(r.skipped, [{ path: "Research > A page", why: "a webarchive file, which wr1t3r doesn't open" }]);
	assert.ok(!r.notes.some((n) => /Old/.test(n.path)));
	const all = r.remarks.join("\n");
	assert.match(all, /Right-click the Manuscript folder/);
	assert.match(all, /Scene is color 2/);
	assert.match(all, /1 document's notes are at the end/);
	assert.match(all, /1 comment came in/);
	assert.match(all, /1 item in Scrivener's Trash/);
	assert.match(all, /Snapshots stay in Scrivener/);
});

// ---- Scrivener 2 (and Scrivener 1 for Windows): numbered files in Files/Docs ----

test("Scrivener 2: numbered documents", () => {
	const r = run({
		"Old Book.scriv/Old Book.scrivx": `<?xml version="1.0"?><ScrivenerProject><Binder>
			<BinderItem ID="0" Type="DraftFolder"><Title>Draft</Title><Children>
				<BinderItem ID="5" Type="Text"><Title>Scene</Title></BinderItem>
			</Children></BinderItem></Binder></ScrivenerProject>`,
		"Old Book.scriv/Files/Docs/5.rtf": rtf("{|rtf1 Words.}"),
		"Old Book.scriv/Files/Docs/5_synopsis.txt": "Short.",
		"Old Book.scriv/Files/Docs/5_notes.rtf": rtf("{|rtf1 A note.}"),
	});
	assert.equal(r.notes.find((n) => n.path === "Draft/Scene.md").text, "---\nsynopsis: Short.\n---\nWords.\n\n%%\nNotes from Scrivener:\n\nA note.\n%%\n");
});

test("not a Scrivener project", () => {
	assert.throws(() => readScrivener(["notes.md"], () => ""), /isn't a Scrivener project/);
});
