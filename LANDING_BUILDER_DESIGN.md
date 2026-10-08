# Landing page builder: design

Written 2026-10-08 for Wave 0 of [LANDING_BUILDER_PLAN.md](LANDING_BUILDER_PLAN.md). This is the
contract the renderer (Wave 1a), the publish branch (Wave 1b) and the editor (Wave 2) build to.
The model it describes is code, not intent: `src/types/pageBuilder.ts` (the shapes),
`src/lib/pageBuilder/model.mjs` (the rules, plain JavaScript so the server can import it) and
`src/lib/pageBuilder/model.d.mts` (its types). `page-builder-model.test.mjs` pins the rules. The
JSON and the tables below were produced by running that code, not typed by hand.

Where this file and the code disagree, the code is right and this file is stale.

## 1. The document

A page made with the builder keeps its tree at `PageNodeData.builder`. A page without `builder`
renders exactly as it does today. Nothing else on the node changes.

```
BuilderDoc  = { version: 1, theme, sections: Section[] }
Section     = { id, kind: 'section', props, style, children: Column[] }      at least 1, at most 6
Column      = { id, kind: 'column',  props: {}, style, children: (Widget | InnerSection)[] }
InnerSection is a Section inside a column; its columns hold widgets only
Widget      = { id, kind: 'widget', type, props, style }                   never children
```

The deepest a page goes is section > column > inner section > column > widget.

Rules `validateBuilderDoc` enforces (every refusal answers the path, never a throw):

- `version` is 1. A higher number says the page came from a newer builder.
- Kinds are section, column and widget; widget types are the 19 in the registry (section 6).
- An id is a letter, then letters, digits, hyphens or underscores, at most 64, and unique on
  the page. It is safe as a CSS class without escaping, which the renderer relies on.
- A section holds columns and nothing else, at least one and at most 6.
- A widget has no `children` field at all, not even an empty one.
- Props and style keys not in the registry are refused, so nothing unchecked reaches the page.
  A prop that is absent is fine: it reads as the widget's default (`propsWithDefaults`).
- Numbers are finite and in range. Colours are `#rgb`, `#rrggbb`, `#rrggbbaa` or a theme token
  (`theme.primary`, `theme.secondary`, `theme.background`, `theme.surface`, `theme.text`,
  `theme.muted`). Links are empty, `http://` or `https://` with a host, a path on this site
  starting with one `/`, or a same-page anchor such as `#offer`. Nothing else: no
  `javascript:`, no `data:`, no `//host`. A video link must be on YouTube or Vimeo.
- No string over 20,000 characters, no list over 50 items, no more than 200 nodes.

The tree operations (`insertNode`, `moveNode`, `removeNode`, `duplicateNode`) never change the
document they are given. Each answers `{ ok: true, doc, id }` with a new document, or
`{ ok: false, reason }` in plain words. A move's index is where the node ends up, counted after it
has left its old place. A section always keeps one column: removing or moving out its last one is
refused, and the reason says to remove the section instead. `duplicateNode` places the copy right
after the original and gives every node in it a new id.

### One real page

The starter map's landing page (`src/lib/defaultBlueprint.ts`, "Lead Capture Lander"), converted
with `migrateLegacyPage`. It has no headline yet, a lead gate, a hero image and the default review
wall, so it converts to two sections. A page with a countdown gets a third section on top; one
with a stock line, subhead, points, trust line or order bump gets those widgets in the copy column.

```json
{
  "version": 1,
  "theme": {
    "colors": {
      "primary": "#EC4899",
      "secondary": "#10B981",
      "background": "#09080E",
      "surface": "#161320",
      "text": "#F8FAFC",
      "muted": "#94A3B8"
    },
    "fonts": {
      "heading": "Playfair Display",
      "body": "Outfit"
    },
    "radius": 16,
    "spacingScale": 8,
    "buttonStyle": "solid",
    "containerWidth": 840
  },
  "sections": [
    {
      "id": "legacy-offer",
      "kind": "section",
      "props": {
        "label": "Offer",
        "anchor": "",
        "contentWidth": "boxed",
        "columnGap": 36,
        "stackOn": "mobile"
      },
      "style": {
        "desktop": {
          "backgroundColor": "theme.surface",
          "borderWidth": 1,
          "borderStyle": "solid",
          "borderColor": "#ffffff14",
          "borderRadius": 20,
          "shadow": "lg",
          "paddingTop": 36,
          "paddingRight": 36,
          "paddingBottom": 36,
          "paddingLeft": 36
        },
        "mobile": {
          "paddingTop": 24,
          "paddingRight": 24,
          "paddingBottom": 24,
          "paddingLeft": 24
        }
      },
      "children": [
        {
          "id": "legacy-offer-media",
          "kind": "column",
          "props": {},
          "style": {
            "desktop": {
              "width": 48
            }
          },
          "children": [
            {
              "id": "legacy-product",
              "kind": "widget",
              "type": "productHero",
              "props": {
                "productId": "",
                "variantId": "",
                "collectionId": "",
                "title": "",
                "price": "",
                "productImage": "",
                "imageUrl": "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80",
                "imageAlt": "",
                "showPrice": true
              },
              "style": {
                "desktop": {}
              }
            }
          ]
        },
        {
          "id": "legacy-offer-copy",
          "kind": "column",
          "props": {},
          "style": {
            "desktop": {
              "width": 52
            }
          },
          "children": [
            {
              "id": "legacy-headline",
              "kind": "widget",
              "type": "heading",
              "props": {
                "text": "",
                "level": 1,
                "link": ""
              },
              "style": {
                "desktop": {
                  "fontFamily": "theme.heading"
                }
              }
            },
            {
              "id": "legacy-checkout",
              "kind": "widget",
              "type": "checkoutButton",
              "props": {
                "label": "Continue",
                "discountCode": "",
                "checkoutMode": "lead-gate",
                "cartAction": "checkout",
                "showCodeNote": true,
                "fullWidth": true
              },
              "style": {
                "desktop": {}
              }
            }
          ]
        }
      ]
    },
    {
      "id": "legacy-reviews",
      "kind": "section",
      "props": {
        "label": "Reviews",
        "anchor": "",
        "contentWidth": "boxed",
        "columnGap": 24,
        "stackOn": "mobile"
      },
      "style": {
        "desktop": {
          "paddingTop": 24,
          "paddingBottom": 24
        }
      },
      "children": [
        {
          "id": "legacy-reviews-col",
          "kind": "column",
          "props": {},
          "style": {
            "desktop": {}
          },
          "children": [
            {
              "id": "legacy-reviews-wall",
              "kind": "widget",
              "type": "reviewsWall",
              "props": {
                "headline": "",
                "minRating": 4,
                "photos": true
              },
              "style": {
                "desktop": {}
              }
            }
          ]
        }
      ]
    }
  ]
}
```

### What converting a page carries where

`migrateLegacyPage` is deterministic (the same page gives the same ids, all starting `legacy-`)
and leaves the flat fields alone, so "Back to simple editor" loses nothing until the builder page
is first published. It writes what the published page shows today, in the merchant's own words:

| Today's field | Widget and prop |
|---|---|
| `urgencyText`, `urgencyMinutes` (only when the timer is on and minutes are positive) | countdown `legacy-countdown-timer`: `text`, `minutes` |
| `shopifyProductId`, `shopifyVariantId`, `shopifyCollectionId` | productHero `legacy-product`: `productId`, `variantId`, `collectionId` |
| `shopifyProductTitle`, `shopifyProductPrice`, `shopifyProductImage` | productHero: `title`, `price`, `productImage` |
| `heroImageUrl` | productHero: `imageUrl` |
| `scarcityBatchText`, `scarcityBatchCount` (only when on and a line shows) | stockCount `legacy-stock`: `text`, `count` |
| `headline` | heading `legacy-headline`: `text`, level 1 |
| `subhead` | text `legacy-subhead`: `text` |
| `bullets` | iconList `legacy-bullets`: `items[n].text` |
| `trustBadge` | trustBadge `legacy-trust`: `text` |
| `orderBump*` (only when `orderBumpEnabled` is true) | orderBump `legacy-bump`: `productId`, `variantId`, `headline`, `description`, `title`, `price`, `image` |
| `buttonText`, `discountCode`, `checkoutMode`, `cartAction` | checkoutButton `legacy-checkout`: `label`, `discountCode`, `checkoutMode`, `cartAction` |
| `socialProofHeadline`, `socialProofMinRating`, `socialProofPhotosEnabled` (unless the wall is off) | reviewsWall `legacy-reviews-wall`: `headline`, `minRating`, `photos` |

What today's page already hides stays hidden: instructions saved as copy ("New value point"),
the seeded sample trust and stock lines, and the name, price and image of a product or add-on
picked with a placeholder variant id. A link the builder refuses is left empty in the widget.

Not converted, because the fixed frame reads them from the node: slug and label, the three
pixels, exit intent, the mobile sticky bar, cookie consent and the privacy link, the A/B settings,
publishing and domains, and the metrics. Not converted because nothing on today's page reads
them: `postSubmitAction`, `customRedirectUrl`, `postSubmitExperience`, `checkoutUrl`.

Version B: `migrateLegacyPage(data, { variant: 'b' })` lays `variantB` over version A the way the
live page does and gives the same ids, so the two documents can be compared node by node.

## 2. Style and the cascade

Every node has `style.desktop`, and `style.tablet` and `style.mobile` only where they differ.
Style keys are flat (`paddingTop`, not `padding.top`) so a phone can change one side without
restating the other three. `resolveStyle(node, device)` answers one flat object: desktop, then
the tablet layer over it, then the mobile layer over that. A key a layer leaves out is inherited,
an absent layer inherits everything, and null or undefined count as left out.

Two keys behave on purpose in ways worth knowing:

- `hidden` cascades like everything else. "Hide on desktop only" therefore writes
  `hidden: true` on desktop and `hidden: false` on tablet. The inspector shows three switches
  and writes those layers for the merchant; the merchant never sees the cascade.
- `customClass` is allowed on the desktop layer only, because a class cannot change per device.

| Key | Group | Inspector label | Accepts |
|---|---|---|---|
| `paddingTop` | spacing | Padding top | number 0 to 400 px |
| `paddingRight` | spacing | Padding right | number 0 to 400 px |
| `paddingBottom` | spacing | Padding bottom | number 0 to 400 px |
| `paddingLeft` | spacing | Padding left | number 0 to 400 px |
| `marginTop` | spacing | Margin top | number -400 to 400 px |
| `marginRight` | spacing | Margin right | number -400 to 400 px |
| `marginBottom` | spacing | Margin bottom | number -400 to 400 px |
| `marginLeft` | spacing | Margin left | number -400 to 400 px |
| `backgroundColor` | background | Background colour | colour |
| `backgroundImage` | background | Background image | link |
| `backgroundFocalX` | background | Focal point, left to right | number 0 to 100 % |
| `backgroundFocalY` | background | Focal point, top to bottom | number 0 to 100 % |
| `backgroundOverlayColor` | background | Overlay colour | colour |
| `backgroundOverlayOpacity` | background | Overlay strength | number 0 to 100 % |
| `borderWidth` | border | Border width | number 0 to 40 px |
| `borderStyle` | border | Border style | none, solid, dashed, dotted |
| `borderColor` | border | Border colour | colour |
| `borderRadius` | border | Corner radius | number 0 to 400 px |
| `shadow` | border | Shadow | none, sm, md, lg, xl |
| `fontFamily` | typography | Font | theme.heading, theme.body or a Google Fonts family |
| `fontSize` | typography | Size | number 8 to 200 px |
| `fontWeight` | typography | Weight | 100, 200, 300, 400, 500, 600, 700, 800, 900 |
| `lineHeight` | typography | Line height | number 0.5 to 4 |
| `letterSpacing` | typography | Letter spacing | number -10 to 40 px |
| `textAlign` | typography | Alignment | left, center, right, justify |
| `textColor` | typography | Text colour | colour |
| `width` | layout | Width | number 1 to 100 % |
| `maxWidth` | layout | Maximum width | number 40 to 4000 px |
| `align` | layout | Position across | start, center, end, stretch |
| `verticalAlign` | layout | Content top to bottom | top, middle, bottom |
| `minHeight` | layout | Minimum height | number 0 to 2000 px |
| `hidden` | advanced | Hide on this device | on or off |
| `customClass` | advanced | CSS class | class names, desktop layer only |

Which keys apply: all of them on sections and columns (typography set there is inherited by the
widgets inside). On a widget, `verticalAlign` does nothing and `width` is a percentage of its
column. On a column, `width` is its share of the section's row on that device. Columns stack into
one on the devices the section's `stackOn` names, and a stacked column ignores its width.

### Theme

`theme.colors` holds six hex colours, `theme.fonts` a heading and a body Google Fonts family,
plus `radius`, `spacingScale` (the step spacing presets multiply), `buttonStyle` (solid, outline
or pill) and `containerWidth`. A new page starts from today's published look: the pink, emerald,
near-black and slate of `renderPublicFunnelHtml`, Playfair Display over Outfit, an 840px
container.

## 3. The renderer contract (Wave 1a)

```
render(doc, context) -> { html, css, problems }
```

- **Where it lives.** `src/lib/pageBuilder/render.mjs` with `render.d.mts`, plain ESM, importing
  only `model.mjs`. The server imports it for `/p/*` and the editor's canvas imports it. No DOM,
  no network, no clock, no randomness: the same document and context give the same strings.
- **Validate first.** `render` runs `validateBuilderDoc`. A document with problems renders
  nothing and answers the problems; the publish route refuses it with 400 naming them, and the
  canvas shows them. A broken page is never published half drawn.
- **The context** carries what the page cannot know from the document: `slug`, `journeyId`,
  `nodeId`, the store domain and currency, the server's `realVariantId` (so a placeholder variant
  is refused in exactly one place, the same one the frame uses), the review wall's verified
  reviews, the A/B version being served, and `device` for the canvas (below).
- **The HTML** is one root, `<div id="jvb-root" class="jvb">`, then one element per node:
  `<section>` for a section, `<div>` for a column, the widget's own markup for a widget. Every node
  carries the class `jvb-n-<id>`; the id is CSS-safe because validation made it so. Every text
  prop is escaped. Every link is checked again with the model's rule before it is written.
- **CSS is scoped to the page root.** Every rule starts with `#jvb-root`, so nothing the merchant
  sets can reach the frame, the lead modal, the consent banner or the cockpit around the canvas.
  The theme becomes custom properties on the root (`--jvb-primary`, `--jvb-font-heading`, ...)
  and a token such as `theme.primary` is written as `var(--jvb-primary)`. Numbers are written
  with their unit by the renderer; no string from the document is ever pasted into CSS except a
  colour, a font family and a class name, each already validated against its pattern.
- **The media query rule.** The desktop layer is written with no media query. The tablet layer
  follows inside `@media (max-width: 1024px)` and the mobile layer last inside
  `@media (max-width: 640px)`. Each block holds only the keys that layer sets, and the order
  (desktop, tablet, mobile) is what makes CSS reproduce `resolveStyle`. `hidden: true` writes
  `display: none`; `hidden: false` writes the node's natural display back.
- **The canvas** passes `context.device`. The HTML is byte for byte the published HTML; the CSS is
  `resolveStyle` for that one device with no media queries, because the canvas shows a phone
  inside a desktop window and a media query answers the window, not the frame.
- **Fonts.** The renderer lists the Google Fonts families the page uses so the frame can emit one
  stylesheet link. Families are validated names, never URLs.
- **Words the merchant did not write** are only the registry's `fallbacks`, each word for word
  what today's page shows (section 6). An empty heading, text, image or list renders nothing.

### The sanitiser (HTML embed, and links inside text)

The HTML embed widget is the only place a merchant's markup reaches the page. The sanitiser is a
small parser in `render.mjs` with no dependency and no DOM, so it runs on the server.

- Kept: `p br strong b em i u s small span div blockquote ul ol li h2 h3 h4 h5 h6 hr a img figure
  figcaption table thead tbody tr th td code pre`. Any other tag is dropped and its text kept.
- Dropped with everything inside them: `script style template noscript iframe frame object
  embed applet form input button select textarea link meta base svg math`, and comments.
- Attributes kept: `href src alt title width height colspan rowspan loading class`. Every
  attribute whose name starts with `on`, every `style`, every `srcset` and every attribute not on
  that list is dropped.
- `href` and `src` pass the model's link rule (http or https, a path on this site, or an anchor);
  anything else, including `javascript:`, `vbscript:` and `data:` in any letter case or with
  entities or whitespace hidden in it, removes the attribute. Decoding happens before the check.
- `target="_blank"` is only ever written by the renderer, always with `rel="noopener noreferrer"`.
- Wave 1a pins it with the fixtures in `public-inline-script.test.mjs` plus its own.

The text widget's markdown subset (paragraphs, bold, italic, links, lists) escapes first and
then builds its few tags, so it never needs the sanitiser except for its links.

### The embed allowlist

The page's Content Security Policy keeps `frame-src` closed. The video widget accepts a link on
`VIDEO_HOSTS` only (youtube.com, youtu.be, youtube-nocookie.com, vimeo.com, player.vimeo.com and
their www forms). The renderer takes the video id out of the link (YouTube: 6 to 20 letters,
digits, `-` or `_`; Vimeo: digits) and writes the iframe itself, at
`https://www.youtube-nocookie.com/embed/<id>` or `https://player.vimeo.com/video/<id>`, with the
widget's `title` as the frame's accessible name. A link it cannot read renders nothing and the
canvas says why. Wave 1b adds those two origins to the Sentinel's frame source in `server.mjs`,
pinned by a test. The HTML embed never produces a frame.

### Commerce widgets and the frame

The frame around the blocks stays as it is: tracking, consent, pixels, UTM capture, exit intent,
the sticky bar, A/B and head tags. The commerce widgets reuse today's fragments and element ids,
so the frame's script finds them: the checkout button is `main-cta-btn`, the order bump's box is
`bump-checkbox-page`, the stock line and countdown keep their ids. The lead form widget posts
exactly the body the lead modal posts today to `/api/public/lead`: `slug`, `email`, `name`,
`phone`, `order_bump_selected`, `variant`, `currency`, the five UTM fields (with `utm_content`
suffixed `var-<a|b>` as today), `fbclid`, `ttclid`, `gclid`, `visitorId` and `ref`.

## 4. Drop zones (Wave 2)

A drop zone is drawn only where the model would accept the drop; the editor asks the model
(`insertNode` or `moveNode` on the current document) rather than keeping a second copy of the
rules.

| Dragged | May land | Never |
|---|---|---|
| A widget from the palette | Any column, top-level or inner, before any child or after the last; an empty column is one zone. Between sections on the page, where the editor wraps it in a new one-column section | Straight into a section, onto the page as a bare widget |
| A layout from the palette (1 to 4 columns, or 50/50, 33/67, 67/33, 25/75) | Between sections on the page; inside a top-level column, as an inner section | Inside an inner section's column |
| A section | Between sections; into a top-level column as an inner section, if it holds no inner section itself | Into an inner column; into itself |
| A column | Before or after a sibling in its section; into another section with fewer than 6 columns | Out of a section whose only column it is; onto the page |
| A widget | Any column at any position | A section, the page |
| An inner section | Within its column; another top-level column; out onto the page as a section | An inner column |

What reorder means for each kind: sections reorder top to bottom on the page; columns reorder
left to right within their row (on a stacked phone layout that reads top to bottom); widgets
reorder top to bottom within a column and move freely between columns.

The keyboard does every one of these (section 7), and every drop, pointer or keyboard, is one
undo step.

## 5. The inspector

Three tabs. **Content** draws one field per prop from the registry's `props` spec below.
**Style** draws the style keys grouped as in section 2 and edits the layer of the device the
switch shows; a value inherited from a larger device shows as inherited, with a control to set
it here or reset it. **Advanced** holds hide per device, the CSS class and, for a section, its
anchor.

### Sections and columns

| Prop | Field | Accepts |
|---|---|---|
| `label` | Name in the outline | text |
| `anchor` | Anchor for links (#name) | anchor name |
| `contentWidth` | Content width | boxed, full |
| `columnGap` | Space between columns | number 0 to 120 px, whole |
| `stackOn` | Stack columns on | tablet, mobile, never |

A column has no props. Its width, alignment and spacing are style, set per device.

## 6. Widgets

The palette groups them as Basic, Content, Media, Proof and Sell. A new widget starts with no
copy, no product, no price and no claim: an empty prop is a hint in the editor, never words on the
page. "Empty shows" is the only text a page prints that the merchant did not write, word for word
what today's page prints (`page-builder-model.test.mjs` pins it against `pagePreviewCopy.ts` and
`publicRoutes.mjs`). "Inline" marks the props the canvas edits in place.

#### Heading (`heading`), Basic

A title for the page or a section.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `text` | Text | text, several lines | `""` | yes |  |
| `level` | Level | 1, 2, 3, 4, 5, 6 | `2` |  |  |
| `link` | Link | link | `""` |  |  |

Default style: `{"desktop":{"fontFamily":"theme.heading"}}`.

#### Text (`text`), Basic

Paragraphs with bold, italic, links and lists.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `text` | Text | text, markdown subset | `""` | yes |  |

Default style: `{"desktop":{"fontFamily":"theme.body"}}`.

#### Image (`image`), Basic

A picture, with alt text for screen readers.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `src` | Image | link | `""` |  |  |
| `alt` | Alt text | text | `""` |  |  |
| `caption` | Caption | text | `""` | yes |  |
| `link` | Link | link | `""` |  |  |
| `fit` | Fit | cover, contain | `"cover"` |  |  |
| `aspect` | Shape | auto, 1:1, 4:3, 3:4, 16:9, 9:16 | `"auto"` |  |  |

#### Button (`button`), Basic

A link that looks like a button.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `label` | Label | text | `""` | yes |  |
| `url` | Link | link | `""` |  |  |
| `newTab` | Open in a new tab | on or off | `false` |  |  |
| `variant` | Look | primary, secondary, outline | `"primary"` |  |  |
| `size` | Size | sm, md, lg | `"md"` |  |  |
| `fullWidth` | Full width | on or off | `false` |  |  |

#### Spacer (`spacer`), Basic

Empty space. Set its height for each device in Style.

Content: none. Its height is the Style tab's minimum height, set per device.

Default style: `{"desktop":{"minHeight":40}}`.

#### Divider (`divider`), Basic

A line between blocks.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `lineStyle` | Line | solid, dashed, dotted | `"solid"` |  |  |
| `thickness` | Thickness | number 1 to 20 px, whole | `1` |  |  |
| `color` | Colour | colour | `"theme.muted"` |  |  |
| `length` | Length | number 5 to 100 % | `100` |  |  |

#### Icon list (`iconList`), Content

Short points, each with an icon.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `icon` | Icon | check, star, arrow, dot | `"check"` |  |  |
| `items` | Points | list of up to 50 points: text (text) | `[]` | yes |  |

#### FAQ (`faq`), Content

Questions that open to show their answers.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `items` | Questions | list of up to 50 questions: question (text); answer (text, several lines) | `[]` | yes |  |
| `openFirst` | Open the first answer | on or off | `false` |  |  |

#### Video (`video`), Media

A YouTube or Vimeo video.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `url` | YouTube or Vimeo address | link, YouTube or Vimeo | `""` |  |  |
| `title` | Title for screen readers | text | `""` |  |  |
| `aspect` | Shape | 16:9, 4:3, 1:1, 9:16 | `"16:9"` |  |  |
| `startAt` | Start at | number 0 to 86400 s, whole | `0` |  |  |

#### HTML embed (`htmlEmbed`), Media

Your own HTML. Scripts, event handlers and javascript: links are removed.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `html` | HTML | HTML, sanitised | `""` |  |  |
| `title` | Name for screen readers | text | `""` |  |  |

#### Testimonials (`testimonials`), Proof

Quotes from customers, in their own words.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `layout` | Layout | grid, stack | `"grid"` |  |  |
| `items` | Testimonials | list of up to 50 testimonials: quote (text, several lines); name (text); role (text); avatarUrl (link); rating (number 0 to 5, whole) | `[]` | yes |  |

#### Reviews wall (`reviewsWall`), Proof

Verified reviews from your store. Shows only when there are some.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `headline` | Heading | text | `""` | yes | "Customer reviews" |
| `minRating` | Lowest rating shown | number 1 to 5 stars | `4` |  |  |
| `photos` | Show review photos | on or off | `true` |  |  |

#### Trust badge (`trustBadge`), Proof

One reassuring line, such as your returns promise.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `text` | Line | text | `""` | yes |  |
| `icon` | Icon | none, shield, lock, star | `"none"` |  |  |

#### Countdown (`countdown`), Sell

A timer that counts down for each visitor, or to one date.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `text` | Line before the clock | text | `""` | yes | "This offer timer runs for" |
| `mode` | Counts down | evergreen, deadline | `"evergreen"` |  |  |
| `minutes` | Minutes for each visitor | number 0 to 525600 min | `0` |  |  |
| `deadline` | Ends at | date and time | `""` |  |  |
| `expiredText` | Line once it ends | text | `""` |  | "Reservation extended for final checkout:" |

#### Lead form (`leadForm`), Sell

Asks for an email, and a name or phone if you choose, and saves the lead.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `heading` | Heading | text | `""` | yes | "Leave your email" |
| `buttonText` | Button | text | `""` | yes | "Send" |
| `nameField` | Name | hidden, optional, required | `"optional"` |  |  |
| `phoneField` | Phone | hidden, optional, required | `"optional"` |  |  |
| `successText` | Thanks line | text | `""` |  | "Thanks. Your details were received." |
| `afterSubmit` | After sending | message, checkout | `"message"` |  |  |

#### Product (`productHero`), Sell

Your store product, with its image and price.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `productId` | Product | text | `""` |  |  |
| `variantId` | Variant | text | `""` |  |  |
| `collectionId` | Collection | text | `""` |  |  |
| `title` | Product name | text | `""` |  |  |
| `price` | Price | text | `""` |  |  |
| `productImage` | Product image | link | `""` |  |  |
| `imageUrl` | Image | link | `""` |  |  |
| `imageAlt` | Alt text | text | `""` |  |  |
| `showPrice` | Show the price | on or off | `true` |  |  |

#### Checkout button (`checkoutButton`), Sell

Sends the visitor to checkout, or asks for an email first.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `label` | Button | text | `""` | yes | "Continue" |
| `discountCode` | Discount code | text | `""` |  |  |
| `checkoutMode` | Checkout | direct, lead-gate | `"direct"` |  |  |
| `cartAction` | Counts as | checkout, add | `"checkout"` |  |  |
| `showCodeNote` | Say the code is ready at checkout | on or off | `true` |  |  |
| `fullWidth` | Full width | on or off | `true` |  |  |

#### Order bump (`orderBump`), Sell

A one-tick add-on beside the checkout button.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `productId` | Product | text | `""` |  |  |
| `variantId` | Variant | text | `""` |  |  |
| `headline` | Headline | text | `""` | yes | "Add this to the order" |
| `description` | Description | text, several lines | `""` | yes |  |
| `title` | Add-on name | text | `""` |  | "Add-on" |
| `price` | Price | text | `""` |  |  |
| `image` | Image | link | `""` |  |  |

#### Stock count (`stockCount`), Sell

How many units are left, in your words.

| Prop | Field | Accepts | Default | Inline | Empty shows |
|---|---|---|---|---|---|
| `text` | Stock line | text | `""` | yes | "Limited batch: {count} units remaining" |
| `count` | Units left | number 0 to 1000000 | `0` |  |  |

## 7. Keyboard and screen readers

The house rule from [JOURNEY_UI_HANDOFF.md](JOURNEY_UI_HANDOFF.md) applies whole: keyboard and
screen reader users can do everything, text is 11px or larger (`MIN_TEXT_PX` in
`src/lib/a11y.ts`), nothing scrolls sideways at 390px, and no copy has an em dash. On top of it:

- **The builder is a full-screen dialog** over the page editor. It registers on the dialog stack
  (`openDialog` in `a11y.ts`) so Escape closes only what is on top, traps Tab inside itself
  (`nextTrapIndex`) and gives focus back to "Open builder" when it closes (`pickReturnTarget`).
- **Escape, in order:** cancels a drag in progress; else leaves inline editing, keeping the text;
  else clears the selection; else closes the builder (the work is already autosaved).
- **The outline is a tree** (`role="tree"`, `aria-level`, `aria-expanded`, `aria-selected`) with
  one tab stop. Up and Down move between visible rows, Right opens a row or enters it, Left closes
  it or goes to its parent, Home and End go to the first and last row, Enter selects and opens the
  inspector. The canvas follows the outline's selection and the outline follows the canvas's.
- **Editing keys** act on the selected node: Delete or Backspace removes it, Cmd or Ctrl+D
  duplicates it, Alt+Up and Alt+Down move it one place within its parent, Alt+Shift+Up and
  Alt+Shift+Down move it into the previous or next column or section, Cmd or Ctrl+Z undoes and
  Cmd or Ctrl+Shift+Z redoes. A run of Alt+arrow presses is one undo step, as a run of arrow moves
  on the journey map is (`keyboardMoves.ts`).
- **Drag and drop** uses `@dnd-kit`'s keyboard sensor: Space or Enter picks up, arrows move,
  Space or Enter drops, Escape cancels.
- **Every change is announced** in one polite live region, in a sentence that names the thing
  and where it went: "Heading moved to Offer, column 2, position 1 of 4." "Text removed. Undo
  with Command Z." A refused move announces the model's reason. Save status is announced the same
  way, politely.
- **Every control has a name**: icon buttons carry `aria-label`, the device switch is a radio
  group named "Editing for", an inline edit is a `textbox` named by its prop's label, and every
  colour control has a hex text field beside it.
- **The page the merchant publishes** must stay accessible too: one level 1 heading (conversion
  makes the headline that heading), alt text on every image the merchant has not marked
  decorative, a title on every video, visible labels on the lead form's fields, and nothing that
  moves for a visitor who asked for reduced motion. Wave 2 adds Check design rules that name a
  page breaking one; none exist yet.

## 8. Open questions

Answered by default as written until the owner says otherwise.

1. **An empty headline.** Today's page prints "Offer" when the headline is empty. A converted
   page's heading stays empty and the canvas shows a hint, because the builder writes no copy the
   merchant did not. Default: keep it empty, and Check design asks for a headline as it does now.
2. **A/B on a builder page.** Today version B overrides seven fields. Conversion can build the B
   document with the same ids. Open: store a second document, or per-widget overrides keyed by
   id. Default for Wave 1b: a builder page serves version A only and the A/B switch says so, until
   this is decided.
3. **More than one checkout button or product on a page.** The frame's script binds one
   `main-cta-btn`, and the sticky bar and the tracking beacon read one product. Default: the first
   in page order is the one the frame binds; any later checkout button clicks it; Check design
   flags a second product.
4. **Where the frame reads the product on a builder page** (the beacon's ids and price, the
   sticky bar's title and price). Default: from the first productHero widget, not the flat fields.
5. **Container queries.** They would let the canvas and the published page share one CSS string.
   The plan chose media queries at 1024 and 640; the canvas uses resolved CSS per device instead.
6. **`data:` image addresses** are refused by the builder's link rule. Today's page publishes them
   if one was saved. A converted page leaves such an image empty in the widget; the flat field
   keeps it.
7. **Countdown to a date** is new (today's timer is per visitor). Default: the date must carry a
   time zone offset, and the line shows the expired text once it passes.
8. **A minimum rating above 5.** Today it hides every review; conversion clamps it to 5.
9. **Lead form labels.** Today's modal uses placeholders as labels. Default: the lead widget shows
   visible labels; the modal is unchanged in Wave 1.
10. **Testimonials are the merchant's own words**, not verified reviews. Default: the widget says
    nothing about verification, and the reviews wall stays the only verified source.
