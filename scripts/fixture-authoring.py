"""Authoring tool for the frozen evaluation fixture (PLAN.md section 6).

Original text written for this project (no third-party source). Run once to (re)generate
src/data/evaluation/{corpus,calibration,questions}.json with exact UTF-16 offsets and the identity hash
used by src/lib/hash.ts. It never runs the app. The corpus is ASCII so code points equal UTF-16 units.

    python scripts/fixture-authoring.py            # write JSON
    python scripts/fixture-authoring.py --check    # verify the committed JSON matches, write nothing

Freeze rule: once a calibration or evaluation run has been looked at, do not edit labels or text here.
A change requires a new FIXTURE_VERSION and a fresh calibration.
"""
import json
import pathlib
import re
import sys

FIXTURE_ID = "cedar-ridge-tool-library"
FIXTURE_VERSION = "eval-v1"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "evaluation"

PAGES = [
"""Cedar Ridge Tool Library Member Handbook

Membership is open to any adult who lives, works or studies in Cedar Ridge County. Applicants must show a photo ID and a document with a current local address, such as a utility bill or a lease. Students may use a campus enrollment letter instead of a utility bill.

An individual membership costs 40 dollars per year. A household membership covers up to four adults at one address and costs 65 dollars per year. Members who receive county food or housing assistance may join for free; no proof beyond the assistance card is required.

Each membership comes with one library card. A lost card can be replaced at the front desk for 2 dollars. Cards are not transferable, and a member who lends a card to a neighbor may have borrowing paused for 30 days.

Memberships renew on the anniversary of the sign-up date. The library sends a reminder email two weeks before the renewal date. If a membership lapses, open loans must be returned before the account can be renewed.

Youth between 14 and 17 may borrow hand tools on a parent's household membership. Youth may not borrow power tools or use the workshop without an adult member present.

The library does not sell member contact details. Email addresses are used only for reminders, overdue notices and the quarterly newsletter, and members can opt out of the newsletter at any time.""",
"""Borrowing Rules

Members may have up to five tools on loan at one time. A household membership shares a limit of eight tools across all of its cards. Large items, such as tile saws, pressure washers and the trailer-mounted wood chipper, count as two tools each.

The standard loan period is seven days. Power tools that require a safety checkout have a loan period of four days so that more members can use them. A loan can be renewed once, online or at the desk, if no other member has placed a hold on that tool.

Holds may be placed on any tool that is currently out. When a held tool comes back, the member who placed the hold has 48 hours to pick it up before it goes to the next person in line. Each member may hold up to three tools at once.

Tools must be returned clean and with all of their parts, blades, bits and cases. Staff check every returned tool at the counter before the loan is closed. Batteries for cordless tools must be returned with at least some charge left; the library charges them overnight.

The wood chipper can only be borrowed by members who bring a vehicle with a rated towing hitch. Staff will help attach the chipper but will not tow it for members. Loans of the chipper are limited to one weekend per member per month.""",
"""Late Returns, Damage and Fees

The library charges a late fee of 1 dollar per tool for each day the tool is overdue. Late fees stop growing after 20 dollars per tool. Members with more than 10 dollars in unpaid fees cannot check out new tools until the balance is paid.

There is no late fee for tools returned during a declared weather emergency. In that case the due date moves to the second day the library reopens after the closure.

Normal wear, such as dull blades or worn sanding pads, is never charged to the member. If a tool is broken through misuse, the member pays the repair cost, up to the replacement value listed in the catalog. Members are asked to report damage when they return the tool rather than leave it in the drop box.

A tool that is more than 30 days overdue is treated as lost. The member is billed the full replacement value, and borrowing is suspended until the tool is returned or the bill is paid. If a lost tool is later returned in working condition, the replacement charge is refunded but any late fees remain.

Fees can be paid at the desk by card or cash, or online through the member portal. The library does not accept checks. Members who face hardship can ask the coordinator to convert fees into volunteer hours at a rate of 10 dollars per hour.""",
"""Power Tool Safety and Training

Some tools are marked with an orange tag in the catalog. An orange-tag tool can only be borrowed after the member completes a safety checkout for that tool category. Checkouts cover circular saws, routers, chainsaws, tile saws and nail guns.

A safety checkout takes about 45 minutes and is free for members. Checkouts are offered every Tuesday evening and on the first Saturday of each month. Members must bring closed-toe shoes and must tie back long hair before the session begins.

During the checkout, a volunteer instructor shows how to inspect the tool, how to change the blade or bit, and how to use the guard. The member then makes three practice cuts under supervision. A member who does not pass may repeat the session at no cost.

Chainsaw checkouts are different. Chainsaws are lent only to members who complete the two-hour chainsaw course, and the borrower must wear the chaps and helmet that are lent with the saw. The library does not lend chainsaws for cutting trees that are taller than the borrower can safely reach from the ground.

Eye protection is included with every saw, grinder and drill. Hearing protection is available at the desk on request. Members who are injured while using a borrowed tool should seek care first and then tell the library, so that the tool can be inspected before it is lent again.""",
"""Workshop Reservations

The workshop has four workbenches, a drill press, a bandsaw and a dust collection system. Members can reserve one bench for a block of up to three hours. Reservations open fourteen days in advance and are made through the member portal.

A bench reservation is held for 15 minutes past its start time. After that the bench is released to members who are waiting. Members who miss two reservations in a month cannot book again until the next month.

The bandsaw and drill press may only be used after the matching safety checkout. Finishing work with spray paint, lacquer or other solvent-based products is not allowed indoors because the room does not have a spray booth. Water-based stains and brush-on finishes are fine.

The workshop closes 30 minutes before the library does so that members have time to clean up. Members must sweep their bench, empty the dust bin if it is more than half full, and return shared clamps to the wall rack. Projects can be stored on the overflow shelf for up to one week, labeled with the member's name and the date.

Groups such as scout troops or school classes can book the whole workshop for a private session. Group bookings need at least three weeks of notice, an adult supervisor for every five participants, and a signed group waiver.""",
"""Hours, Location and Holidays

The library is in the lower level of the Cedar Ridge Community Center at 210 Mill Street. The entrance is at the back of the building, next to the loading dock. Free parking is available in the community center lot, and two spaces near the dock are reserved for loading large tools.

Regular hours are Tuesday through Friday from 3:00 to 8:00 p.m. and Saturday from 9:00 a.m. to 4:00 p.m. The library is closed on Sunday and Monday. The returns drop box at the loading dock is open at all times except during snow removal.

The library closes on New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving and the following Friday, and from December 24 through December 26. When a holiday closure falls on a due date, the tool is due on the next day the library is open.

During summer, from the second week of June to the end of August, Saturday hours start one hour earlier, at 8:00 a.m. Weekday hours do not change in summer.

The building has an elevator from the main lobby and an accessible restroom on the lower level. Members who cannot lift a heavy tool from the counter can ask staff to carry it to the loading dock. Service animals are welcome in all areas except the workshop while machines are running.""",
"""Donations and the Repair Clinic

The library accepts donated hand tools, power tools and garden equipment in working condition. Donations are checked by a volunteer before they are added to the catalog. Tools that cannot be repaired are recycled through the county metal program rather than thrown away.

The library cannot accept gas-powered equipment with fuel still in the tank, tools with frayed cords, or any item that contains asbestos. Paint, chemicals and used motor oil are also refused; they should go to the county hazardous waste day instead.

Donors can ask for a receipt for tax purposes. The receipt lists the items but does not state their value, because the library is not allowed to appraise donations.

The repair clinic meets on the third Sunday of each month in the workshop, from noon to 3:00 p.m. It is the only time the library opens on a Sunday. Volunteers help residents fix lamps, small appliances, bicycles and garden tools, and the clinic is open to everyone, not only members.

Clinic visitors may bring up to two items each. The clinic does not repair microwave ovens, because their capacitors can hold a dangerous charge even when unplugged. Replacement parts are sold at cost, and labor is free.""",
"""Volunteers and Governance

The library is run by a nonprofit board of seven members elected at the annual meeting in March. Any member in good standing can vote at the annual meeting or stand for election to the board. Board meetings are open to the public and are held on the second Wednesday of each month.

Volunteers staff the front desk, inspect returned tools, teach safety checkouts and run the repair clinic. New volunteers attend a 90-minute orientation and then shadow an experienced volunteer for two shifts. Desk shifts last three hours.

Volunteers who give at least 24 hours in a calendar year receive a free individual membership for the following year. Hours are logged in the member portal and confirmed by the volunteer coordinator.

The library is funded by membership fees, a county community grant and donations. It has two paid staff members: a coordinator who manages volunteers and the catalog, and a part-time technician who maintains and repairs the tools.

Suggestions for new tools can be made through the member portal. The board reviews suggestions every quarter and buys new tools based on member demand, safety and storage space. Members can also sponsor a specific tool, and sponsored tools carry a small plate with the sponsor's name.""",
]

# (id, kind, text, [(page, exact quote), ...])
CALIBRATION = [
    ("cal-lost-card", "lexical", "What does it cost to replace a lost library card?",
     [(1, "A lost card can be replaced at the front desk for 2 dollars.")]),
    ("cal-bench-hold", "lexical", "How long is a bench reservation held past its start time?",
     [(5, "A bench reservation is held for 15 minutes past its start time.")]),
    ("cal-teen-jigsaw", "paraphrase", "Can my teenager take out a jigsaw on our family plan?",
     [(1, "Youth may not borrow power tools or use the workshop without an adult member present.")]),
    ("cal-new-equipment", "paraphrase", "Who decides which new equipment gets purchased?",
     [(8, "The board reviews suggestions every quarter and buys new tools based on member demand, safety and storage space.")]),
    ("cal-saturday-summer", "multi-evidence", "What are the regular Saturday hours, and do they change in summer?",
     [(6, "Regular hours are Tuesday through Friday from 3:00 to 8:00 p.m. and Saturday from 9:00 a.m. to 4:00 p.m."),
      (6, "During summer, from the second week of June to the end of August, Saturday hours start one hour earlier, at 8:00 a.m.")]),
    ("cal-refused-donations", "multi-evidence", "Which donations are refused, and where should hazardous items go?",
     [(7, "The library cannot accept gas-powered equipment with fuel still in the tank, tools with frayed cords, or any item that contains asbestos."),
      (7, "Paint, chemicals and used motor oil are also refused; they should go to the county hazardous waste day instead.")]),
    ("cal-chainsaw-course-price", "hard-negative", "How much does the chainsaw course cost?", []),
    ("cal-washer-rental-price", "hard-negative", "What is the daily rental price for the pressure washer?", []),
    ("cal-board-quorum", "hard-negative", "How many board members must attend a meeting for a vote to count?", []),
    ("cal-clinic-laptops", "hard-negative", "Does the repair clinic fix laptops?", []),
    ("cal-parking-count", "hard-negative", "How many parking spaces does the community center lot have?", []),
    ("cal-three-year-renewal", "hard-negative", "Can I renew my membership for three years at once?", []),
]

EVALUATION = [
    ("ev-individual-cost", "lexical", "How much does an individual membership cost per year?",
     [(1, "An individual membership costs 40 dollars per year.")]),
    ("ev-late-fee", "lexical", "What is the late fee per tool for each overdue day?",
     [(3, "The library charges a late fee of 1 dollar per tool for each day the tool is overdue.")]),
    ("ev-checkout-length", "lexical", "How long does a safety checkout take?",
     [(4, "A safety checkout takes about 45 minutes and is free for members.")]),
    ("ev-reservation-window", "lexical", "How far in advance do workshop bench reservations open?",
     [(5, "Reservations open fourteen days in advance and are made through the member portal.")]),
    ("ev-drop-box", "lexical", "When is the returns drop box at the loading dock open?",
     [(6, "The returns drop box at the loading dock is open at all times except during snow removal.")]),
    ("ev-clinic-items", "lexical", "How many items can each clinic visitor bring?",
     [(7, "Clinic visitors may bring up to two items each.")]),
    ("ev-assistance-free", "paraphrase", "Are yearly dues waived for people on county aid?",
     [(1, "Members who receive county food or housing assistance may join for free; no proof beyond the assistance card is required.")]),
    ("ev-keep-longer", "paraphrase", "If somebody is waiting for the drill I have, may I keep it another week?",
     [(2, "A loan can be renewed once, online or at the desk, if no other member has placed a hold on that tool.")]),
    ("ev-month-overdue", "paraphrase", "What happens if I hang on to something for more than a month?",
     [(3, "A tool that is more than 30 days overdue is treated as lost.")]),
    ("ev-dull-blade", "paraphrase", "Will I be billed because my saw got blunt from ordinary use?",
     [(3, "Normal wear, such as dull blades or worn sanding pads, is never charged to the member.")]),
    ("ev-aerosol-finish", "paraphrase", "May I use an aerosol finish on my furniture indoors?",
     [(5, "Finishing work with spray paint, lacquer or other solvent-based products is not allowed indoors because the room does not have a spray booth.")]),
    ("ev-who-fixes", "paraphrase", "Who keeps the equipment in good working order?",
     [(8, "It has two paid staff members: a coordinator who manages volunteers and the catalog, and a part-time technician who maintains and repairs the tools.")]),
    ("ev-earn-membership", "paraphrase", "How can I earn a membership without paying by helping out?",
     [(8, "Volunteers who give at least 24 hours in a calendar year receive a free individual membership for the following year.")]),
    ("ev-what-to-wear", "paraphrase", "What should I wear to the saw training?",
     [(4, "Members must bring closed-toe shoes and must tie back long hair before the session begins.")]),
    ("ev-sunday-open", "multi-evidence", "Is the library ever open on a Sunday?",
     [(6, "The library is closed on Sunday and Monday."),
      (7, "The repair clinic meets on the third Sunday of each month in the workshop, from noon to 3:00 p.m.")]),
    ("ev-household-washer", "multi-evidence", "How many tools can a household have out, and how does a pressure washer count?",
     [(2, "A household membership shares a limit of eight tools across all of its cards."),
      (2, "Large items, such as tile saws, pressure washers and the trailer-mounted wood chipper, count as two tools each.")]),
    ("ev-fee-cap-block", "multi-evidence", "What is the most I could owe in late fees on one tool, and when do unpaid fees block new checkouts?",
     [(3, "Late fees stop growing after 20 dollars per tool."),
      (3, "Members with more than 10 dollars in unpaid fees cannot check out new tools until the balance is paid.")]),
    ("ev-chipper-rules", "multi-evidence", "What do I need to borrow the wood chipper, and how often can I take it?",
     [(2, "The wood chipper can only be borrowed by members who bring a vehicle with a rated towing hitch."),
      (2, "Loans of the chipper are limited to one weekend per member per month.")]),
    ("ev-moving-trucks", "negative", "Does the library rent out moving trucks?", []),
    ("ev-workshop-key", "hard-negative", "What is the fee for a replacement workshop key?", []),
    ("ev-board-hours", "hard-negative", "How many volunteer hours are required to join the board?", []),
    ("ev-bench-late-fee", "hard-negative", "What is the late fee for an overdue workshop bench reservation?", []),
    ("ev-welding", "negative", "Does the library offer welding classes?", []),
    ("ev-tile-saw-value", "hard-negative", "What is the replacement value of the tile saw?", []),
]

EXPECTED_COUNTS = {
    "calibration": {"lexical": 2, "paraphrase": 2, "multi-evidence": 2, "negatives": 6},
    "evaluation": {"lexical": 6, "paraphrase": 8, "multi-evidence": 4, "negatives": 6},
}


def fnv_lane(text, seed):
    h = seed
    for ch in text:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def identity_hash(text):
    # Mirrors src/lib/hash.ts identityHash (ASCII input: code point == UTF-16 code unit).
    return "fnv64:%08x%08x" % (fnv_lane(text, 0x811C9DC5), fnv_lane(text, 0x050C5D1F))


def pages_hash(pages):
    return identity_hash("\f".join("%d\n%s" % (p["pageNumber"], p["canonicalText"]) for p in pages))


def build():
    for text in PAGES:
        assert all(ord(c) < 128 for c in text), "corpus must be ASCII"
    pages = [{"pageNumber": i + 1, "canonicalText": t} for i, t in enumerate(PAGES)]
    source_hash = pages_hash(pages)
    corpus = {
        "fixtureId": FIXTURE_ID,
        "fixtureVersion": FIXTURE_VERSION,
        "displayName": "Cedar Ridge Tool Library handbook (evaluation corpus)",
        "extractionVersion": "fixture-v1",
        "contentHash": source_hash,
        "provenance": "Original text authored for browser-doc-qa on 2026-10-23. Fictional organization.",
        "pages": pages,
    }

    def split(name, rows):
        questions = []
        for qid, kind, text, quotes in rows:
            units = []
            for n, (page_no, quote) in enumerate(quotes):
                page = PAGES[page_no - 1]
                start = page.find(quote)
                assert start >= 0, "%s: quote not found on page %d" % (qid, page_no)
                assert page.find(quote, start + 1) < 0, "%s: quote ambiguous on page %d" % (qid, page_no)
                others = [i + 1 for i, p in enumerate(PAGES) if i != page_no - 1 and quote in p]
                assert not others, "%s: quote also on pages %s" % (qid, others)
                units.append({"unitId": "%s#%d" % (qid, n + 1), "sourceHash": source_hash, "pageNumber": page_no,
                              "start": start, "end": start + len(quote), "quote": quote})
            negative = kind in ("negative", "hard-negative")
            assert negative == (len(units) == 0), "%s: answerables need units, negatives none" % qid
            questions.append({"id": qid, "suite": name, "kind": kind, "text": text, "evidenceUnits": units})
        counts = {"lexical": 0, "paraphrase": 0, "multi-evidence": 0, "negatives": 0}
        for q in questions:
            counts["negatives" if q["kind"] in ("negative", "hard-negative") else q["kind"]] += 1
        assert counts == EXPECTED_COUNTS[name], "%s counts %s" % (name, counts)
        return {"fixtureId": FIXTURE_ID, "fixtureVersion": FIXTURE_VERSION, "split": name,
                "sourceHash": source_hash, "questions": questions}

    calibration = split("calibration", CALIBRATION)
    evaluation = split("evaluation", EVALUATION)
    cal_ids = {q["id"] for q in calibration["questions"]}
    cal_text = {q["text"].lower() for q in calibration["questions"]}
    for q in evaluation["questions"]:
        assert q["id"] not in cal_ids and q["text"].lower() not in cal_text, "splits overlap: %s" % q["id"]
    return corpus, calibration, evaluation


def dump(value):
    return json.dumps(value, indent=2, ensure_ascii=True) + "\n"


def main():
    corpus, calibration, evaluation = build()
    files = {"corpus.json": corpus, "calibration.json": calibration, "questions.json": evaluation}
    if "--check" in sys.argv:
        bad = [n for n, v in files.items() if (OUT / n).read_text(encoding="utf-8") != dump(v)]
        print("fixture check:", "OK" if not bad else "MISMATCH %s" % bad)
        sys.exit(1 if bad else 0)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, value in files.items():
        (OUT / name).write_text(dump(value), encoding="utf-8", newline="\n")
    chars = sum(len(p) for p in PAGES)
    print("wrote %s pages=%d chars=%d hash=%s" % (OUT, len(PAGES), chars, corpus["contentHash"]))


if __name__ == "__main__":
    main()
