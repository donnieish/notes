# donnie. — 生活与记录

A personal blog rendered as static pages for GitHub Pages. Notion remains the source of truth for articles, attachments, translations and appearance. The default branch contains site code. The build copies only content selected for publication and visual assets used by the website.

## RSS subscription

Add the site's `rss.xml` URL to a feed reader, or copy the RSS link in the footer. The Pages build uses the same published Notion articles as the blog and includes the latest 30 with summaries and links to the original articles. All three site languages share one feed. No separate service or sync task is required.

## Run or verify a sync

Open **Actions → Sync Notion and publish donnie. → Run workflow**.

- Leave **publish** unchecked for a live Notion connection and build check.
- Check **publish** to deploy the validated build. A failed Notion read, incomplete response, missing attachment, failed build, or broken local link leaves the last successful release active.
- The scheduled workflow runs around minute 23 of each hour when PAGES_AUTOMATIC is true. GitHub can delay scheduled runs and can disable schedules on inactive public repositories after 60 days. This schedule alone is not a permanent maintenance-free trigger.

Use a GitHub Free public repository and the standard Linux runner. Pages uses the free github.io address by default. A read-only secret is provided only to the build process. Repository Actions settings require NOTION_TOKEN as a secret and NOTION_ARTICLES_ID and NOTION_COPY_SOURCE_ID as variables. The Notion connection must be granted read access to both original databases. For a different article library, update the variable, validate with an unchecked run, then publish.

The /settings page links to the protected repository settings and offers device-only shortcut settings. The public site does not accept keys. Access counts require a separately activated analytics origin; without it the site displays articles and sends no counting requests. For content rights, see the website's About page. Font checksums and licenses are in public/fonts.

Run DONNIE_DEMO=1 pnpm build for a local demo. CI rejects demo mode.

For a local build of live content with HEIC uploads, install `heif-convert` with an HEVC decoder. The Pages workflow installs it automatically and publishes the converted WebP, keeping the Notion original unchanged.
