# the topology of attention

3D knowledge graph of real Wikipedia articles, controlled by hand gestures (MediaPipe) or mouse.

    npm install
    npm run dev        # open http://localhost:5173 and allow the webcam
    npm run build      # production build -> dist/

Needs internet at runtime: Wikipedia API + thumbnails, and the MediaPipe hand model (Google CDN). The MediaPipe wasm is copied locally by the predev/prebuild script.

## Content
Articles, thumbnails, intros, URLs: Wikipedia Action API (`generator=search`, `prop=pageimages|extracts|info`, `pithumbsize=500`, `origin=*`). Real article links between loaded articles: `prop=links`. Thumbnails are loaded with CORS, drawn into a texture atlas and mapped onto the 3D card quads. No procedural or local placeholder images; cards without a loaded image stay as plain dark frames while loading and are removed if the image fails after 3 retries.
Edges: cyan = real Wikipedia link between two articles; white = layout-only structure.

## Gestures
- Index finger up: highlight the card under the fingertip, show HUD, zoom/focus toward it
- Fist: compact sphere constellation, camera pulls back
- Open palm: zoom out to the whole graph
- Thumb + index pinch (hold and move): drag/pan the graph

Hand-only flow: point at a card, then move the fingertip onto the HUD and hold it on the link ~1s to open the article.

Mouse fallback (only used when no hand is visible): hover = HUD, click = pin + focus, drag = pan, wheel = zoom, Esc = unpin, space/arrows = next layout, `c` = compact, `z` = zoom out.
