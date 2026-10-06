# Copyright findings: the chosen source book

*Checked 6 Oct 2026 (HKT). Plain-English notes, not legal advice.*

## Which book, and why this one

**Nintendo Adventure Books #1: *Double Trouble* (1991)**, file
`NintendoAdventureBooks01-DoubleTrouble1991.pdf` in the archive.org item
[RetroGamingBooksFiction](https://archive.org/details/RetroGamingBooksFiction).

- **No public-domain or openly licensed gamebook was found.** The archive.org item has no
  `licenseurl` or `rights` metadata, and its files carry no per-file licence. Every gamebook in it was
  published commercially between 1983 and 1995. The uploader's description says titles are added once
  they are "15+ year[s]" past publication. That is the uploader's own rule, not a legal status.
- With nothing open to choose from, I picked the **most representative** gamebook. *Double Trouble*
  branches with "turn to page N" choices, gives you items that unlock later choices, keeps a coin
  score, has a coin-flip random branch, has several GAME OVER endings, and ends with a scorecard. It
  also has a clean text layer (a "Text PDF") and is written for roughly the same age group as the kids
  (the book says "IL 5+").

## Facts about the book

| Field | Value | Source |
|---|---|---|
| Title | Double Trouble (Nintendo Adventure Books, no. 1) | Copyright page in the scan; [gamebooks.org item 1811](https://gamebooks.org/index.php/Item/1811/Show) |
| Author | Credited as "Clyde Bosco", a pseudonym of Russell Ginns | [gamebooks.org](https://gamebooks.org/index.php/Item/1811/Show), [gamebooks.org person page](https://gamebooks.org/index.php/Person/988/Show) (no author name appears on the scanned copyright page) |
| Publisher | Archway Paperback, published by Pocket Books, a division of Simon & Schuster (New York) | Copyright page in the scan |
| Year | 1991 (US edition June 1991) | Copyright page in the scan; gamebooks.org |
| ISBN | 0-671-74112-8 | Copyright page in the scan |
| Copyright notice | "Copyright (c) 1991 by Nintendo. All Rights Reserved." Cover artwork also © 1991 Nintendo. Mario, Luigi, Bowser and others are listed as Nintendo trademarks. Reproduction "in any form whatsoever" is reserved. | Copyright page in the scan |
| Credits | Creative Media Applications, Inc. Series developed by Dan Oehlsen, Lary Rosenblatt and Barbara Stewart. Cover by Greg Wray, puzzle art by Josie Koehne. | Copyright page in the scan |
| archive.org licence/rights metadata | **None** (no `licenseurl` or `rights` field on the item or the file) | [metadata API](https://archive.org/metadata/RetroGamingBooksFiction) |

## Is it public domain? **No.**

- It was published in 1991 with a full copyright notice naming **Nintendo** as the owner.
- **Hong Kong** (where you live): a literary work stays in copyright until 50 years after the end of
  the year its author dies ([Cap. 528 s.17](https://www.hklii.hk/en/legis/ord/528/s17);
  [IPD summary](https://www.ip.gov.hk/en/types-of-ip/copyright/duration-of-copyright/index.html)).
  Even if the work counted as "unknown authorship", the earliest possible expiry would be the end of
  2041 (50 years from 1991). In practice it is protected for decades longer.
- **US** (where it was published): a 1991 work owned by a company typically lasts 95 years from
  publication, so about 2086. If it was not a work made for hire, the term is the author's life plus
  70 years.
- Being hosted on archive.org does **not** make it public domain or give anyone permission to reuse it.
- Separately, the **Mario characters and names are Nintendo copyrights and trademarks**. A brand-new
  story starring Mario would still need Nintendo's permission.

## What would be needed to use the real book in the app

1. **Written permission or a licence from the rights holder.** Per the copyright notice that is
   **Nintendo** (the publisher's notice says to contact Pocket Books / Simon & Schuster). The licence
   would need to cover the text, the illustrations and puzzle art, and the Mario characters and
   trademarks. It would also need to cover the specific use: digitising the book, adapting it into an
   interactive format, and private versus public access.
2. **Private family use is still not clearly allowed.** In Hong Kong there is no general "fair use"
   or private-copying exception. Fair dealing only covers set purposes such as research and private
   study, criticism/review/quotation, parody, and education. Copying for "private use" is not one of
   them, and copying a whole book that stands in for buying it is unlikely to be fair
   ([CLIC on permitted acts](https://www.clic.org.hk/en/topics/intellectualProperty/infringement_of_copyright/B);
   [Cap. 528 s.38](https://www.elegislation.gov.hk/hk/cap528!en/s38?_lang=en)). Typing the book into
   the app, even just for the family, is a risk.
3. **Public hosting is clearly off-limits without a licence.** Putting the text on GitHub Pages or
   Vercel makes it available to the public, which only the copyright owner can authorise. The
   parents' standing rule (only publish public-domain or openly licensed content) rules it out.
4. **What is allowed:** the kids can read a physical or legitimately bought copy. Game *mechanics*
   (page-turn choices, items, coin scores, coin flips) are ideas, not protected text. That is why the
   app uses an **original** story, *The Neon Dragon of Pixel Harbour*, written from scratch and marked
   `"original": true` in its metadata.

## What I did and didn't copy

- **No text, art or characters from *Double Trouble*** (or any other archive.org book) are in the app,
  the schema, the docs or the zip. The research notes describe mechanics in my own words, with counts.
- The downloaded scans were kept *outside* the project folder (in `/workspace/gamebook-research-cache/`
  on the build machine). They are not in git or the zip.

## Side note: Project Aon (Lone Wolf) is not "open"

Lone Wolf is not in this archive.org item, but it often comes up as the "free" gamebook series. Its
[Project Aon License](https://www.projectaon.org/en/Main/License) lets private individuals download and
read the books for free. It **forbids redistributing them or showing them on any site other than
Project Aon's** (s.2.2), and the authors can revoke it (s.2.3). So it also could not be published
through this app without separate permission.
