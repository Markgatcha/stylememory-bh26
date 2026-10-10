DEMO ASSETS — pre-generated images for the recorded demo
=========================================================

Why this folder exists
----------------------
A live A/B comparison takes TWO full generations, sequential, on one GPU:
roughly 2 minutes on an idle machine, longer with a second monitor attached
(both displays are driven by the RTX 5050). That is dead air in a recording.

So: pre-generate, then record. The images in this folder come from the
20-run consistency suite — they are real output, not mockups, and the numbers
you quote on camera are the numbers that produced them.

Which pair to use
-----------------
pair1  delta 19.0%   changed 90.1%   <-- USE THIS ONE
pair2  delta 18.9%   changed 88.5%      backup

pair1 is the highest-divergence pair in the whole 20-run suite, which means
the memory-ON image shows the clearest, most obvious difference. Verified by
looking at both: OFF is a generic figure with dark hair in a dark button-down;
ON has electric blue hair, a red puffer jacket and ripped jeans.

Files
-----
  pair1-memory-OFF.png     what the model produced with memory disabled
  pair1-memory-ON.png      same seed, same prompt, memory enabled
  pair2-memory-OFF.png     backup pair
  pair2-memory-ON.png      backup pair

How to show them on camera
--------------------------
Open both pair1 files side by side in your image viewer BEFORE you start
recording, then alt-tab to them at the 0:25 mark. Full-screen the viewer so
the recording captures only the images, not your desktop.

Say, while pointing:
  "Memory OFF — generic figure, dark hair, dark shirt. It has no idea who Kai is.
   Memory ON — blue hair, red jacket, ripped jeans, crouched stance.
   Same seed. Same prompt. Same size. The only variable was memory."

Then the numbers, which are the actual argument:
  "I ran this 20 times. Memory recall 20 out of 20. Mean pixel divergence
   15 percent, standard deviation 2.3 points. Every single run."

What you can honestly claim
---------------------------
These are real generations from the suite in data/suite20_report.json. Run 6,
seed 208495503459696. The report lists all 20 seeds, so any claim is
reproducible by anyone with the repo.

You are NOT required to generate live on camera. The measurement is the
evidence; the images are exhibits.

Regenerating a pair yourself
----------------------------
If you want a fresh pair rather than the suite's:

  1. A/B Compare tab -> "Kai skateboarding at sunset" -> Run comparison
  2. Note the seed it reports (both arms share it)
  3. Copy the two files out of data/images/ into this folder

Or from the command line:
  curl -s -X POST http://127.0.0.1:3001/api/compare \
    -H "Content-Type: application/json" \
    -d '{"prompt":"Kai skateboarding at sunset"}'
