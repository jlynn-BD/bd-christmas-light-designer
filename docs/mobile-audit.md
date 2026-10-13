# Blue Duck Christmas Lights — Mobile Audit & Optimization Report

**App:** Christmas Light Designer (customer widget, embedded on blueduckchristmaslights.com)
**Scope:** every customer step on phone-sized screens, from the ZIP gate through the thank-you page
**Tested at:** 375 px (typical iPhone) and 320 px (smallest common phone), using Chromium phone emulation
**Not tested:** a real iPhone or Android device. Please try the app on your own phone as a final check.

## What the audit found, and what was done

| # | Finding | Why it matters | Fix |
|---|---|---|---|
| 1 | **The progress bar was wider than a phone screen.** Five 72 px steps overflowed at 375 px. | The page scrolled sideways and the "Quote" step was cut off. | Smaller steps and labels on phones, tighter spacing, and an even smaller layout at 320 px. Every step now fits with no sideways scroll. |
| 2 | **Many tap targets were under 44 px** (buttons, inputs, links, address suggestions). | Apple and Google recommend at least 44 px; smaller targets cause mis-taps. | Minimum 44 px for every button, input and link on phones and touch screens. Text inputs are at least 16 px so iPhones don't zoom in. |
| 3 | **The decoration handles were tiny** (about 20 px) in the customizer. | Hard to grab with a thumb. | 28 px handles with larger invisible touch areas. |
| 4 | **The decoration canvas trapped scrolling.** A swipe over the photo did nothing. | Customers got "stuck" on the Customize step. | A swipe over the photo now scrolls the page. Only the decorations themselves capture touch. |
| 5 | **The ZIP field auto-focused on load.** | The phone keyboard covered the screen immediately. | Auto-focus only on desktop. Phones get the numeric keypad. |
| 6 | **The package images were huge** (1.7–2.1 MB each, PNG). | Slow on cellular data. | Converted to JPG at 137–228 KB, about 12 times smaller, with no visible loss. |
| 7 | **AI previews were about 2.5 MB each, four per generation.** | A ~10 MB download on a phone. | The server converts them to high-quality JPEG, about 170–320 KB each, roughly 7 times smaller. |
| 8 | **Phone photos are 4–12 MB** and carry rotation metadata. | Slow, fragile uploads, and sideways houses. | The photo is shrunk to at most 2048 px in the browser before upload, with the rotation baked in. |
| 9 | **The step-to-step scroll bug (Matt's report).** New steps sometimes opened mid-page. | Customers missed the top of each step. | Instant scroll to the top on every step change. Inside the website embed, the page also tells the host page to scroll (see the follow-up below). |
| 10 | **Package step:** the cards sit below the image, so the new image changed out of sight on a phone. | Customers didn't see the effect of their tap. | Tapping a package scrolls the image into view and shows a "Continue with {package} →" button right under it. |
| 11 | **Dropped signal during generation** showed a cryptic error. | Customers didn't know what to do. | A clear message: "We lost your connection… please check your signal and try again." |
| 12 | A 1 px overflow in the ZIP input row at 375 px. | Minor, but caused a tiny sideways scroll. | Fixed. |

## Verification

- **375 px:** every step was exactly 375 px wide, with no sideways scroll, and no tap target under 44 px.
- **320 px:** every step (ZIP gate, property type, design, confirm, lighting, package, quote, thank-you) had no overflow.
- **Package flow on a phone:** tapping a package scrolled to its image, showed the "Continue with…" button, and both Continue buttons worked.
- **AI previews:** a real generation returned four JPEGs of 170–320 KB.
- **Customizer:** real mouse drags, resize, remove and "Looks Good Now" were tested after the editor was later refactored (see the note below).

## Follow-ups

1. **WordPress embed:** the website's embed snippet should honor the new scroll message so each step lands at the right spot. The snippet is in our earlier conversation, and the handler line is:
   `window.scrollTo(0, iframe.getBoundingClientRect().top + window.pageYOffset + (event.data.offset || 0));`
   If the site has a sticky header, subtract its height.
2. **Test on real devices:** Safari on iPhone and Chrome on Android.
3. **Later bug found and fixed:** the ✕ on a decoration wasn't responding to a real click and looked like an oval on phones. This was fixed after the original audit.
