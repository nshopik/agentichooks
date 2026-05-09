_Source: `Plugin Guidelines _ Marketplace.html` (Elgato Marketplace docs)._  
_Image references resolve relative to `Plugin Guidelines _ Marketplace_files/`._

---
# Plugin Guidelines

The following style guide outlines the guidelines that your Stream Deck plugin's metadata must conform to when publishing on Marketplace. In doing so, it ensures an inclusive, consistent, and good user-experience for Stream Deck users.

On this page, you'll learn more about:

- Guidelines for defining the metadata associated with your plugin.
- Image dimensions and requirements.
- General best practices, such as providing visual feedback.

Change requests

We, Elgato, reserve the right to request changes to your product to ensure it conforms the necessary guidelines. Failure to do so may result in your Marketplace submission being declined, or your product being removed from Marketplace.

## UUIDs[​](https://docs.elgato.com/guidelines/stream-deck/plugins#uuids "Direct link to UUIDs")

Universally unique identifiers (UUIDs) are used by Stream Deck and Marketplace to identify:

- Your [plugin](https://docs.elgato.com/streamdeck/sdk/references/manifest/#manifest-uuid).
- [Actions](https://docs.elgato.com/streamdeck/sdk/references/manifest/#action-uuid) within your plugin.

Requirements

- **Do:** include author (organization name) and plugin name in your plugin UUID — for example `com.elgato.volume-controller`.
- **Do:** prefix action UUIDs with your plugin UUID — for example `com.elgato.volume-controller.mute-audio-device`.

- **Don't:** change UUIDs after publishing your plugin.

Recommendations

- **Recommended:** reverse DNS format — consider using the format `{DOMAIN}.{PRODUCT}`, for example `com.elgato.wave-link`.
- **Recommended:** [`VisibleInActionsList`](https://docs.elgato.com/streamdeck/sdk/references/manifest/#action-visibleinactionslist) — prefer cloning actions, and hiding older implementations instead of changing action UUIDs.

## Plugin[​](https://docs.elgato.com/guidelines/stream-deck/plugins#plugin "Direct link to Plugin")

### Name[​](https://docs.elgato.com/guidelines/stream-deck/plugins#name "Direct link to Name")

Your plugin's name is a word, or short phrase, that uniquely identifies your plugin and the functionality it provides.

Requirements

- **Do:** use a unique name — check your name is available on [Marketplace](https://marketplace.elgato.com/stream-deck/plugins).
- **Do:** accurately reflect the functionality provided by your plugin.

- **Don't:** infringe copyright or trademarks.
- **Don't:** use derogatory or offensive vocabulary.

Recommendations

- **Recommended:** descriptive and concise — for example "Volume Controller", "Screen Capture", "Color Picker", etc.
- **Recommended:** memorable and easy to pronounce.

- **Not recommended:** organization name — avoid including your organization name in your plugin's name; organization is already visible on Marketplace.

### Author[​](https://docs.elgato.com/guidelines/stream-deck/plugins#author "Direct link to Author")

The [`Author`](https://docs.elgato.com/streamdeck/sdk/references/manifest/#manifest-author) field within the manifest uniquely identifies you, or your organization, as the creator of the plugin, and is visible within Marketplace and Stream Deck.

Requirements

- **Do:** use your Marketplace organization name.
- **Do:** use company name where applicable — for example "Elgato".
- **Do:** use your real name, if you wish too — for example "Jane Doe".
- **Do:** use your online alias, if you wish too — for example "jdodo".

- **Don't:** infringe copyright or trademarks.
- **Don't:** use derogatory or offensive vocabulary

### Icon[​](https://docs.elgato.com/guidelines/stream-deck/plugins#icon "Direct link to Icon")

Your plugin's [icon](https://docs.elgato.com/streamdeck/sdk/references/manifest#manifest-icon), visible within Stream Deck preferences pane, must adhere to the following guidelines.

#### Sizing[​](https://docs.elgato.com/guidelines/stream-deck/plugins#sizing "Direct link to Sizing")

![](./Plugin Guidelines _ Marketplace_files/6rb268Lybb1ROKKrET6c7O-7e3e0507c3deb62c014d583908f4012b.png)

Plugin icon, 256 × 256 px and 512 × 512 px (high DPI).

Requirements

- **Do:** use PNG format.
- **Do:** accurately portray what your plugin does.

- **Don't:** infringe copyright.
- **Don't:** use offensive imagery.

## Actions List[​](https://docs.elgato.com/guidelines/stream-deck/plugins#actions-list "Direct link to Actions List")

### Naming[​](https://docs.elgato.com/guidelines/stream-deck/plugins#naming "Direct link to Naming")

Your plugin's [category](https://docs.elgato.com/streamdeck/sdk/references/manifest#manifest-category) and [action names](https://docs.elgato.com/streamdeck/sdk/references/manifest#action-name) must accurately represent their functionality, and be sufficiently descriptive but concise (approximately 30 characters or less).

![](./Plugin Guidelines _ Marketplace_files/2rLaOPSUqq1gMuXcKmru00-c4d9133d7911ea2578d7149849232fde.png)

Requirements

- **Do:** specify the [category](https://docs.elgato.com/streamdeck/sdk/references/manifest#manifest-category).
- **Do:** use the same, or similar, values for plugin [name](https://docs.elgato.com/streamdeck/sdk/references/manifest/#manifest-name) and [category](https://docs.elgato.com/streamdeck/sdk/references/manifest/#manifest-category).

- **Don't:** include author names in category, for example "Camera Controls (John Doe)".
- **Don't:** use derogatory or offensive vocabulary.

Recommendations

- **Recommended:** specify action [tooltips](https://docs.elgato.com/streamdeck/sdk/references/manifest#action-tooltip).
- **Recommended:** "Volume Controller", "Mute Audio Device" — descriptive and concise names.
- **Recommended:** "Twitch Mod Controls" — descriptive without infringing copyright exclusivity.

- **Not recommended:** "Moderator Controls for Streaming" — too vague, and more than 30 characters.
- **Not recommended:** "Toggle Chat Mode And Send Message" — should be two separate actions.
- **Not recommended:** "Elgato Wave Link" — omit organization when also the author, prefer "Wave Link".

### Icons[​](https://docs.elgato.com/guidelines/stream-deck/plugins#icons "Direct link to Icons")

[Category](https://docs.elgato.com/streamdeck/sdk/references/manifest#manifest-categoryicon) and [action](https://docs.elgato.com/streamdeck/sdk/references/manifest#action-icon) icons within the action list supports both vectorized (SVG) and rasterized (PNG) image files, with SVG being the recommended format to provide optimal scaling.

#### Sizing[​](https://docs.elgato.com/guidelines/stream-deck/plugins#sizing-1 "Direct link to Sizing")

![](./Plugin Guidelines _ Marketplace_files/4Ka2hIQJOBKp3HXeOG7ATj-7f07e6bba3b427691685a27d1db8c89a.png)

Category icon, 28 × 28 px — and 56 × 56 px (high DPI) when using rasterized images.

![](./Plugin Guidelines _ Marketplace_files/3yKoq4kGGhzMfARo6SVtV3-5c91aecc97090d8695355070e1e4b43b.png)

Action icon, 20 × 20 px — and 40 × 40 px (high DPI) when using rasterized images.

Requirements

- **Do:** use SVG or PNG format.
- **Do:** use monochromatic color scheme, with a transparent background.
- **Do:** provide high-DPI variants when using rasterized images (PNG).
- **Do:** use white stroke, `#FFFFFF`, for action list icons.

![](./Plugin Guidelines _ Marketplace_files/361j2rFyMqiATt6Ga2Iuk3-989449d45bdd981e699badc6a9537875.png)

Good — Monochromatic category icon with white stroke.

![](./Plugin Guidelines _ Marketplace_files/3jVIga8Yg50ChkQ0wNlwGI-35b0bf2ad92759beb2f85f1038a6380c.png)

Good — Monochromatic action icon with white stroke; auto-adjusted by Stream Deck.

- **Don't:** use colors to style action list icons.

![](./Plugin Guidelines _ Marketplace_files/3cVDRhxXbnVl7f6iCTW4pA-d65ab5def229ab54fa40ac62a474193d.png)

Bad — Action lists icons with color.

- **Don't:** use solid backgrounds on action list icons.

![](./Plugin Guidelines _ Marketplace_files/4yMahqqMv1DuBNSZU6jFg9-1086fafeb4bb06284395d84edaab3587.png)

Bad — Action list icons with a solid background.

Recommendations

- **Recommended:** SVG — scale well on all devices and layouts.

- **Not recommended:** PNG — rasterized images may not scale well.

### Grouping[​](https://docs.elgato.com/guidelines/stream-deck/plugins#grouping "Direct link to Grouping")

When determining the actions provided by your plugin, you should aim to provide an array of functionality that adds value to your plugin, without overwhelming the user.

Recommendations

- **Recommended:** combine actions — actions with common settings should be consolidated, and have a property inspector for configuring them.

![](./Plugin Guidelines _ Marketplace_files/IQfmpwquAr9yssi799WFV-0ba90a7b76893e2e7550f303b93a2d4b.png)

Good — Consolidate actions that share settings

- **Recommended:** provide a reasonable amount of functionality, between 2 and 30 actions, no more.

- **Not recommended:** avoid static actions that aren't configurable.

![](./Plugin Guidelines _ Marketplace_files/ip1F9WB2f0LqbVX5Xi98b-dfce05b1e61617ae6fd51c21717511c3.png)

Bad — Avoid static actions

## Key Icons[​](https://docs.elgato.com/guidelines/stream-deck/plugins#key-icons "Direct link to Key Icons")

[Key icons](https://docs.elgato.com/streamdeck/sdk/references/manifest#state-image), represented as state images within the manifest, can be vectorized (SVG) or rasterized (PNG) images, with SVG being the recommended format to provide optimal scaling.

In addition to static images, animated (GIF) images may also be specified within the manifest, but cannot be used when programmatically updating actions.

### Sizing[​](https://docs.elgato.com/guidelines/stream-deck/plugins#sizing-2 "Direct link to Sizing")

![](./Plugin Guidelines _ Marketplace_files/6zie824BtwrIK4SAy8YSbm-039ccece6742335c522919d2cc352e55.png)

Key icon, 72 × 72 px — and 144 × 144 px (high DPI) when using rasterized images.

Updating programmatically

When updating key icons programmatically only one image size can be supplied. For rasterized images, it is recommended to provide an image that uses the higher DPI dimensions; Stream Deck will scale the image down accordingly.

Requirements

- **Do:** use SVG, PNG, or GIF format.
- **Do:** use [states](https://docs.elgato.com/streamdeck/sdk/references/manifest#state-image) effectively — update icons when a state associated with the action changes, for example the associated smart light is turned on / off.

Recommendations

- **Recommended:** SVG — vectorized images allow you to provide visually appealing dynamic keys, for example charts and meters.
- **Recommended:** positional awareness — consider grouping actions based on their coordinates to provide new levels of interactions.

![](./Plugin Guidelines _ Marketplace_files/1uNY9NztI0EzXpQegjQM61-09c0688ebf75780c8e8667ac2c81327e.png)

Good — Volume Controller's action act as an interactive slider when actions are paired together.

- **Not recommended:** programmatic flooding — keys are not intended for rendering high frame rate videos; limit programmatic calls to a *maximum* of 10 per second.

## Layouts[​](https://docs.elgato.com/guidelines/stream-deck/plugins#layouts "Direct link to Layouts")

Touch strip [layouts](https://docs.elgato.com/streamdeck/sdk/guides/dials#layouts) found on Stream Deck + support providing rich feedback in the form of elements, and allow for touch and hold interaction. The following should be considered when using layouts.

### Sizing[​](https://docs.elgato.com/guidelines/stream-deck/plugins#sizing-3 "Direct link to Sizing")

![](./Plugin Guidelines _ Marketplace_files/221ZDyM3AL0gCpv2cFtxR5-5f4ba307070ffd1a56181a536c38169e.png)

Touch strip layout, 200 × 100 px

Layout boundary

All elements within a layout must be within the bounds of the layout; if an element exceeds the bounds, the layout will fail to load.

Requirements

- **Do:** use accessible touch size — interactive elements should be accessible, and have a touch size of at least 35 × 35 px.

Recommendations

- **Recommended:** [built-in layouts](https://docs.elgato.com/streamdeck/sdk/guides/dials#built-in-layouts) — where suitable, consider using pre-defined layouts.
- **Recommended:** partial updates — utilize elements effectively to update portions of layouts.
- **Recommended:** responsive — elements should update promptly when the state associated with the

- **Not recommended:** lots of touchable elements — space on the touch strip is limited, and cramped elements can be difficult for users with accessibility requirements.
- **Not recommended:** programmatic flooding — touch strips are not intended for rendering high frame rate videos; limit programmatic calls to a *maximum* of 10 per second.

## Temporary Feedback[​](https://docs.elgato.com/guidelines/stream-deck/plugins#temporary-feedback "Direct link to Temporary Feedback")

Stream Deck SDK enables your plugin to provide feedback to the user when an action (or operation) succeeds or fails.

Requirements

- **Do:** use [`showAlert`](https://docs.elgato.com/streamdeck/sdk/guides/keys#showalert) to inform the user when an action was unsuccessful. Also applicable to [dials](https://docs.elgato.com/streamdeck/sdk/guides/dials#showalert).

Recommendations

- **Recommended:** use [`showOk`](https://docs.elgato.com/streamdeck/sdk/guides/keys#showok) to inform the user of success when there is no visual indicator, for example a file was written or request was sent.

- **Not recommended:** duplicate success indicators — for actions that have visual indication of success, for example a light changing and the action's state updating, `showOk` is unnecessary.

Logging

Use [logging](https://docs.elgato.com/streamdeck/sdk/guides/logging) to record information, specifically when issues occur, to assist with diagnosing potential problems.

## Property Inspectors (UI)[​](https://docs.elgato.com/guidelines/stream-deck/plugins#property-inspectors-ui "Direct link to Property Inspectors (UI)")

Property inspectors within your Stream Deck plugin play an integral role in allowing users to configure and customize your plugin's actions. Property inspectors must adhere to the following guidelines.

Requirements

- **Do:** use checkbox for boolean settings.
- **Do:** use select or radio for single-select settings.
- **Do:** provide validation feedback.
- **Do:** automatically save settings on change.
- **Do:** provide setup help — where necessary, provide links to support pages.

- **Don't:** include donation or sponsor links — prefer "Additional Links" in your product's page on Marketplace.
- **Don't:** list copyright — prefer description, or "Additional Links", in your product's page on Marketplace.
- **Don't:** have a "Save" button for action settings.

Recommendations

- **Recommended:** hidden by default — to prevent flickering, when using a single property inspector file, hide components by default, and show only necessary components on DOM ready.

- **Not recommended:** complex configuration — avoid using *"lots"* of components; prefer splitting the action into smaller actions if necessary.
- **Not recommended:** large paragraphs — space is limited, and should be reserved for configuration.
