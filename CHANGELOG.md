# Changelog

## [0.4.2-beta](https://github.com/xuckless/pixl-playroom/compare/v0.4.1-beta...v0.4.2-beta) (2026-10-10)


### Bug Fixes

* Full HDR on Macs, HDR editing space, Headroom everywhere (0.4.2-beta, silent) ([ad7d964](https://github.com/xuckless/pixl-playroom/commit/ad7d964253a0304ee0632d048d733fe39ae4cacb))
* HDR working space should work properly ([ca45e02](https://github.com/xuckless/pixl-playroom/commit/ca45e0200e2777a861054b8e0ec318e41c323b79))


### Maintenance

* release 0.4.2-beta (silent) ([2848e1e](https://github.com/xuckless/pixl-playroom/commit/2848e1e9825eaefd40e4f8d7bda4765b7fe23a68))

## [0.4.1-beta](https://github.com/xuckless/pixl-playroom/compare/v0.4.0-beta...v0.4.1-beta) (2026-10-09)


### Features

* quick fixes, UI update ([c2fe3ef](https://github.com/xuckless/pixl-playroom/commit/c2fe3ef87b54f70b09c3208337324bd054e8bfd2))


### Bug Fixes

* "Amount" reads as strength in zh/fr/vi; no build output in the repo ([2ff516b](https://github.com/xuckless/pixl-playroom/commit/2ff516b331b03dea1feffde5ebff0476bcce4550))
* language related fixes. ([c2fe3ef](https://github.com/xuckless/pixl-playroom/commit/c2fe3ef87b54f70b09c3208337324bd054e8bfd2))
* **release:** the Mac feed merge keeps the release notes ([0fe93fa](https://github.com/xuckless/pixl-playroom/commit/0fe93facd6e8fc8509d367e157b7b5ca3c02721f))
* **release:** the Mac feed merge keeps the release notes ([75f3c88](https://github.com/xuckless/pixl-playroom/commit/75f3c88c7571da574542e2dea2d4e4a42bfce075))

## [0.4.0-beta](https://github.com/xuckless/pixl-playroom/compare/v0.3.0-beta...v0.4.0-beta) (2026-10-09)


### Features

* added multi language support ([67b25f5](https://github.com/xuckless/pixl-playroom/commit/67b25f56b5cbc8d0871f47b617dd48c624ad9bef))
* **ai:** Gemma download and run, the AI killswitch, heavy models behind a benchmark (0.19) ([34f129c](https://github.com/xuckless/pixl-playroom/commit/34f129cddbadfb483be137b7d2df0c516a33816b))
* **ai:** Gemma names what is in a photo: chips atop Masks, searchable in the Library (0.19) ([e9cc1a4](https://github.com/xuckless/pixl-playroom/commit/e9cc1a4d2b576aab37b4032aa0949c9fa1d19621))
* **ai:** NAFNet on CoreML with static shapes, SCUNet retired, RAW model input bounded (0.19) ([c13279a](https://github.com/xuckless/pixl-playroom/commit/c13279a173fffc3bf67dbf88d72c3adf206245bd))
* **cull:** cull signals per photo: exposure, focus in the subject, blur, blink hint, picture hash (0.19) ([3d336c1](https://github.com/xuckless/pixl-playroom/commit/3d336c18f02993570f6de15078f9458813336adb))
* **cull:** suggested rejects in the Library: dimmed with the reason, Keep or Reject, learnt thresholds (0.19) ([78ef358](https://github.com/xuckless/pixl-playroom/commit/78ef35851a36309f549b015d7ff3d3308113a1f7))
* **detail:** RAW sharpening with the edge mask, and sharpening the ([7d7bc50](https://github.com/xuckless/pixl-playroom/commit/7d7bc50ab20367ac1b03a480ed07f0855a9fb6bd))
* **develop:** remake a RAW's stale DRUNet denoise in place, thumbnails ([c5d25ff](https://github.com/xuckless/pixl-playroom/commit/c5d25ff9da1eb7d0cc56d051a675dba321b29df0))
* **develop:** the Smoothing slider (engine 0.18 adjustment smoothing), ([e7fc1c6](https://github.com/xuckless/pixl-playroom/commit/e7fc1c682d1378b882bcca49461c0b72800fefbc))
* **display:** Full HDR renders in 16-bit float, drawn on a WebGPU canvas ([64fbaad](https://github.com/xuckless/pixl-playroom/commit/64fbaad133146936a6a5b24ba528a9f26d4a3c57))
* **display:** Full HDR's Before and 1:1 tiles in HDR ([87796b2](https://github.com/xuckless/pixl-playroom/commit/87796b2bc39d731dfa1ad6a88f5e0346f127d18f))
* **display:** Full HDR's settled picture as an A/B (F16 frame or AVIF with a gain map) ([ceb2910](https://github.com/xuckless/pixl-playroom/commit/ceb291045500d5321753a93d0507602d32877243))
* **display:** HDR edges, and the 0.18 half of 0.4.0-beta's notes and README ([d5cadea](https://github.com/xuckless/pixl-playroom/commit/d5cadeadc5aec14ba657edcc74c6b0922ab2f6a2))
* **display:** read the screen's HDR headroom (a native macOS reader), state it in Preferences, and the HDR preview spike ([1c4b05f](https://github.com/xuckless/pixl-playroom/commit/1c4b05f8a2e2c1a7fa81b287075bcd0b54f70575))
* **display:** the Full HDR toggle, and the view says which display to render for ([97fc8c1](https://github.com/xuckless/pixl-playroom/commit/97fc8c1becec2d283eb04e8b789c94af6e669505))
* **display:** what reads the picture in Full HDR reads its SDR companion ([47c1e20](https://github.com/xuckless/pixl-playroom/commit/47c1e20a62b8629190ed3f017fc60aac7c2f6f90))
* **engine:** engine 0.18's host rules — contrast, calibration bound, ([f6abfc6](https://github.com/xuckless/pixl-playroom/commit/f6abfc6d12a514d40273ebd2aa1a0ec89d65e250))
* **engine:** run on pixl-engine 0.19.1, and plan Phase O ([5f681d8](https://github.com/xuckless/pixl-playroom/commit/5f681d869089ac64006c2c8df04d6f48b12575cf))
* **engine:** the safe shutdown, and engine writes trusted to be whole (0.19) ([43192c6](https://github.com/xuckless/pixl-playroom/commit/43192c6ba0df4482f3e2ecea3d82eece42a9e99d))
* finalizing translation and quality of life changes ([db055c1](https://github.com/xuckless/pixl-playroom/commit/db055c1609124ce4096d2f9747d80e0f851badc7))
* **heal:** AI Remove with MI-GAN — painted, or the object clicked found ([97829ff](https://github.com/xuckless/pixl-playroom/commit/97829ff7ac04cac167b51a7cdc340d17fdec095a))
* **library:** in Full HDR the thumbnail is a JPEG of the picture as shown ([c011b99](https://github.com/xuckless/pixl-playroom/commit/c011b998fe004541366d8fda9c974f4878ae2032))
* **masks:** Depth range on Depth Anything V2, and SAM's guided edge ([653dd6e](https://github.com/xuckless/pixl-playroom/commit/653dd6e481816294032e7d7670855dd0814b5a96))
* **masks:** Eyes, Brows, Lips and Teeth from the face outlines, a picker per face (0.19) ([e461c03](https://github.com/xuckless/pixl-playroom/commit/e461c0385e88132653c9a6926dd4804f6458b787))
* **masks:** Find by name with EfficientSAM3, SAM 3 held back (0.19) ([0f60bbe](https://github.com/xuckless/pixl-playroom/commit/0f60bbecdd7e0fb4c962c15eb571287c88596e5b))
* **masks:** Fine subject on BiRefNet lite, offered on demand; MI-GAN's ([93a6354](https://github.com/xuckless/pixl-playroom/commit/93a6354b26ef60d60338bee7f60cd62bd3df0d74))
* **masks:** Sky, Vegetation and Water, and Face, Hair, Skin and Clothes in one click (0.19) ([ce9408c](https://github.com/xuckless/pixl-playroom/commit/ce9408cdf330b7297bdd56494aee1af05c1392a9))
* **masks:** the masks pane fixed in the left pane; glass is frost alone over HDR ([56782cd](https://github.com/xuckless/pixl-playroom/commit/56782cd728c09e0ea06d3963ca267de1acf92c2f))
* **models:** Enhance's Scale and Source, retired models and the PixlRGB ([2c7e407](https://github.com/xuckless/pixl-playroom/commit/2c7e40797be6bf1908792056501c10d44a365d7e))
* **raw:** DemosaicNet and PMRID at full size, AHD fallback, binned thumbnails (0.19) ([c810fb2](https://github.com/xuckless/pixl-playroom/commit/c810fb23954e9171de244bdf1c942b14f97485d3))
* **raw:** the RAW master in Scene float (InpaintOpposed), float ([962b0ec](https://github.com/xuckless/pixl-playroom/commit/962b0ec1b90564ac682194db128602a900675bcb))
* readme update and engine bump. ([51f96d5](https://github.com/xuckless/pixl-playroom/commit/51f96d550f1567ec115a4638bdf91876eca9c372))
* **ui:** background work on the top bar, and the efficient UI while Playroom is behind (0.19) ([bd309f3](https://github.com/xuckless/pixl-playroom/commit/bd309f39e1fd2aefa2c8e9574435ee7ae4fcbf05))
* **ui:** Settings as a wide sheet in sections, styled like Export ([5dfe9dd](https://github.com/xuckless/pixl-playroom/commit/5dfe9dd1963e5762e06dae8b2497eec1dd510a69))
* **updates:** "Update available!" with the new version's notes; honest 0.4.0-beta notes; on-demand models mirrored ([ccd10f8](https://github.com/xuckless/pixl-playroom/commit/ccd10f83bc8737bcf62f08037ecd5fc81d88087c))
* window and quality of life changes built ([34d2c28](https://github.com/xuckless/pixl-playroom/commit/34d2c28be8db7127b7b11a69eefd2029ed12972f))


### Bug Fixes

* **ci:** pixl-auto loaded only where installed, not a dependency of 0.4.0-beta ([5e942f2](https://github.com/xuckless/pixl-playroom/commit/5e942f26cbd7a0d0a3424660fe2f7c3fdd7d2bd0))
* **develop:** a floor before every smoothed op (E53's colour blobs on IMG_1826) ([52aaaa2](https://github.com/xuckless/pixl-playroom/commit/52aaaa20649a7018ae4f557fa595f7b2add13395))
* **develop:** floor the look stage's negatives (E53's Dehaze blotches on a Scene master), and a regression test from the owner's two edits ([135d7f4](https://github.com/xuckless/pixl-playroom/commit/135d7f412761ba2f5d5c95a5d0049abb4a3bc5b3))
* **develop:** the Color Mixer unsmoothed until E53; feat(raw): AI steps ([a465bd1](https://github.com/xuckless/pixl-playroom/commit/a465bd1f590ab8342154b5b30c1513d835680ff7))
* **display:** the clipping overlay in Full HDR marks blown at the display's ceiling ([19c2617](https://github.com/xuckless/pixl-playroom/commit/19c26178e1925ac88c9a7aad60347012d6b42a6e))
* **loupe:** 1:1 renders at once: exact zoom, no repeated asks, no blocking remake; region trace for the engine ([c5f9305](https://github.com/xuckless/pixl-playroom/commit/c5f93052ac7fd073ab02ecfaec908ba0b0b043dc))


### Performance

* **loupe:** the engine's viewing guide: F16 1:1 tiles, a quick PPG master first, the working copy reused ([04b27b2](https://github.com/xuckless/pixl-playroom/commit/04b27b2a13a3e217b2e9da8519a1b0669418423b))
* main-thread pixel work into the worker, a sound safe-shutdown rest, "Engine offline" while resting ([1664049](https://github.com/xuckless/pixl-playroom/commit/1664049f29bed1e04593bf6a46205e5f22af0ec3))


### Maintenance

* **release:** 0.4.0-beta ([b62f262](https://github.com/xuckless/pixl-playroom/commit/b62f2622c7c58efd0dc94d7b8d66182d9c3d8fa5))

## [0.3.0-beta](https://github.com/xuckless/pixl-playroom/compare/v0.2.0-beta...v0.3.0-beta) (2026-10-04)


### docs

* the README brought up to 0.3.0-beta ([ba17b77](https://github.com/xuckless/pixl-playroom/commit/ba17b77e1c061fe31c2138739517e84549d82d72))


### Features

* engine 0.17, the four-step export, scopes at full size, PIXL's camera colour ([5073789](https://github.com/xuckless/pixl-playroom/commit/5073789a897dd4f7e20f587a6045a5473e69e656))
* **engine:** move Playroom's request types to engine 0.17.0 ([11739ee](https://github.com/xuckless/pixl-playroom/commit/11739ee4fbe40da5e7ebd5558735f8f6e361f241))
* **export:** guards, preview, preflight and receipt (engine side) ([9002d1e](https://github.com/xuckless/pixl-playroom/commit/9002d1e298c69228f47098f6f55050758febcb5c))
* **export:** the export dialog as four steps of the editor's cards ([e2c67a9](https://github.com/xuckless/pixl-playroom/commit/e2c67a9f5cec8203b8a05bba1b3ea0919ae59669))
* **export:** use the engine's Master colour path for HDR deliveries ([ef2bc28](https://github.com/xuckless/pixl-playroom/commit/ef2bc286cac1da266129e931e19619f59f566c38))
* **masks:** Object detection button, and a crisp one-pixel mask edge ([2b8d78b](https://github.com/xuckless/pixl-playroom/commit/2b8d78be962cfad11cd7424cd6173e20d256f9a1))
* **masks:** remove the pin balls over the photo ([985cdf9](https://github.com/xuckless/pixl-playroom/commit/985cdf93664b4f79f1e37292a99fe912ef3bf78c))
* **models:** keep U2-Net and FBCNN-QF visible as being retired until the next update ([4b1a6f4](https://github.com/xuckless/pixl-playroom/commit/4b1a6f47e58d2dddfd98b4b56faa503ae0e25bb0))
* **raw:** PIXL's own camera colour for every RAW whose body it holds ([992cea8](https://github.com/xuckless/pixl-playroom/commit/992cea8190b73b0f621e3947eef3e4d860c3c5a8))
* **scopes:** the scopes at full size, with CIE 1976 and metrics ([9523e70](https://github.com/xuckless/pixl-playroom/commit/9523e707d890f85a0a4ba85fecc6b700c0a60590))
* **update:** keep legacy previews and compare before/after on first open ([c131898](https://github.com/xuckless/pixl-playroom/commit/c131898b324f869dfa7af6e150bbe00c20c290db))


### Bug Fixes

* **models:** a model whose version moved keeps its downloaded files — ([2eec6e0](https://github.com/xuckless/pixl-playroom/commit/2eec6e0a53cd872bd8cadc3315eb461bedb1dedc))
* **scopes:** helpers out of component files, memoised histogram sources ([d5817a8](https://github.com/xuckless/pixl-playroom/commit/d5817a827d2330cb29a65a9d7f1ac5b462cffcf7))

## [0.2.0-beta](https://github.com/xuckless/pixl-playroom/compare/v0.1.1-beta.1...v0.2.0-beta) (2026-10-02)


### Features

* added more presets from different areas of the industry ([cd73b64](https://github.com/xuckless/pixl-playroom/commit/cd73b6485c99d4cd8232e344471241968045a6aa))
* **engine:** pixl-engine 0.16.0 at parity: LibRaw replaces rawler ([e30e736](https://github.com/xuckless/pixl-playroom/commit/e30e7369c0e72c0d72e473375962f841cba25ed4))
* glass bar sliders, (i) tips, cards and a glass dropdown ([d9a24fe](https://github.com/xuckless/pixl-playroom/commit/d9a24fe351c07732444e88f196d130ac6e91770c))
* hover preview, Amount and swapping for looks ([3d40ad1](https://github.com/xuckless/pixl-playroom/commit/3d40ad1913261fef0504d6d8e252dade057c818a))
* **lens:** defish fisheye lenses with their Lensfun profiles ([c0ffe40](https://github.com/xuckless/pixl-playroom/commit/c0ffe406f6a9a38781161b67441b6faec5de42d8))
* look file format, looks docs and the smart-looks plan ([ef1d2ac](https://github.com/xuckless/pixl-playroom/commit/ef1d2acc23b23e1f4e0859668d8c56933584c93d))
* looks browser with live thumbnails ([0e3a4f6](https://github.com/xuckless/pixl-playroom/commit/0e3a4f6c9da940ff1850500056c3823fd69588a4))
* looks, a new way to make masks, engine 0.16.1, and What's new ([4f5a782](https://github.com/xuckless/pixl-playroom/commit/4f5a782b40bdcae46139a379a72dd3cbe0201ffd))
* **loupe:** sharp 1:1 on straightened, Upright, lens-corrected and cropped photos ([a37e472](https://github.com/xuckless/pixl-playroom/commit/a37e472e5c7c1ec7869a9d24d5c69568e6d5d484))
* **masks:** classes (sky, hair, eyes, skin…) found by a click today, by name later ([2025517](https://github.com/xuckless/pixl-playroom/commit/2025517bedb800244af3ac1dd8a4b16fab68f483))
* **masks:** Molten glass draws a sharp edge as a solid line, its middle lighter ([76faa86](https://github.com/xuckless/pixl-playroom/commit/76faa8673d9034f88c5c9e9853d43ce8d0dd61eb))
* **masks:** native gradient shapes, a bidirectional gradient, Snap to edges ([8833b22](https://github.com/xuckless/pixl-playroom/commit/8833b22ac31a04917c6c1307b76f62524ef1ac11))
* **masks:** Snap to edges on a brush keeps the stroke to its object (SAM) ([56cdfd9](https://github.com/xuckless/pixl-playroom/commit/56cdfd9261ec717f54f726e9191701c4dbae204f))
* **masks:** the Objects and Sky tools, Find object, and a Model needed popup ([3b2f8c3](https://github.com/xuckless/pixl-playroom/commit/3b2f8c39b9efb7e7469bcf0d33d2775a8e44b0f3))
* potentail mask fix. ([abc8862](https://github.com/xuckless/pixl-playroom/commit/abc88625f8e958ebe6627c09b2937f76ae6330d2))
* preset applying works ([a0b8db9](https://github.com/xuckless/pixl-playroom/commit/a0b8db9647b7f94edd2d3e53f8ac13f0c1591c5b))
* save your own presets with their masks and AI steps as instructions ([7a72d5a](https://github.com/xuckless/pixl-playroom/commit/7a72d5adc3b57b22de33a00b220cf84f372add76))
* **select:** SAM 2.1 select by clicks, a box and strokes, on its own engine ([27b469e](https://github.com/xuckless/pixl-playroom/commit/27b469e2b0f72d70e57692604c1238e9ff8e63db))
* smart looks run: model masks, AI steps, picking and the smart catalog ([235a75f](https://github.com/xuckless/pixl-playroom/commit/235a75fc08312da069ecc19083b3d341ec70149c))
* smart looks: instructions and the planner ([cc398b2](https://github.com/xuckless/pixl-playroom/commit/cc398b22a3891750f4741b3d11e5aa03837a5d4f))
* tune the looks catalog so each look reads at a glance ([5d7926d](https://github.com/xuckless/pixl-playroom/commit/5d7926d30b458ff8285a633efe338c40e2637756))
* What's new, once, after an update ([c79ae35](https://github.com/xuckless/pixl-playroom/commit/c79ae35e3888d41d79bc96b17182250c4c73d362))
* working on our preset library ([335ec79](https://github.com/xuckless/pixl-playroom/commit/335ec79e0e2c1a85fde9c7e2f470f58b8a3b0e21))


### Bug Fixes

* **engine:** pixl-engine 0.16.1 ([aa6dba3](https://github.com/xuckless/pixl-playroom/commit/aa6dba31b46a1de29ecd269454bc546a672ca4b2))
* library ui and behavioral fixes ([a2d5480](https://github.com/xuckless/pixl-playroom/commit/a2d54806fb82462dd6fb7ac98d5322e7accdc083))
* **library:** a portrait RAW's first thumbnail is upright ([c99f351](https://github.com/xuckless/pixl-playroom/commit/c99f351c47e1addd5f65cf1aba728def9345d4e2))
* **loupe:** the mask preview survives StrictMode's remount in development ([3cf3bf9](https://github.com/xuckless/pixl-playroom/commit/3cf3bf93102b95bd86685b9934b0414dc999c853))
* **masks:** crisp SAM edges, no halo around the object ([1626745](https://github.com/xuckless/pixl-playroom/commit/1626745031fdf398a7bcede4c7b22112e2181dbf))
* **masks:** crisp Select Subject and Background edges, no glow ([04af4e1](https://github.com/xuckless/pixl-playroom/commit/04af4e14d515d0f126d1d3746b207dc7b7ee2dea))
* **masks:** show what Objects will take, as a tint, live while a box is drawn ([dd54dd5](https://github.com/xuckless/pixl-playroom/commit/dd54dd54ca49fc1d4a91a8d885f3d25d7c1eba4a))
* **masks:** the People tools say "soon" until they are ready ([23325ce](https://github.com/xuckless/pixl-playroom/commit/23325cedf689cbba212fd7700ef4f299d7955768))
* Molten glass style masks ([255c2e6](https://github.com/xuckless/pixl-playroom/commit/255c2e61e0833d63317c7a37f051eb96d50cac95))
* release: macOS feed job's GitHub bridge ([a782ddc](https://github.com/xuckless/pixl-playroom/commit/a782ddc4e49f0572f904d1558eb96a2ad0426a65))
* release: the GitHub bridge merges latest-mac.yml (the GitHub publisher ignores channels), attaches it as beta-mac.yml too, and never holds up the R2 feeds ([39c2067](https://github.com/xuckless/pixl-playroom/commit/39c20677c86fd3b06f7b9e2927603692267b3cb8))


### Performance

* **raw:** half-size RAW develops for proxies ([2657929](https://github.com/xuckless/pixl-playroom/commit/265792927d4359396b83b64dddc8df52a0cc8740))

## [0.1.1-beta.1](https://github.com/xuckless/pixl-playroom/compare/v0.1.1-beta...v0.1.1-beta.1) (2026-10-01)


### Features

* account and abuse hardening, added protections, checks for accouts ([cf9fa23](https://github.com/xuckless/pixl-playroom/commit/cf9fa2363a405eec3e204f066f1bab0a6850c212))
* beta terms inside the app; no-liability notice on the beta gate ([e77dc4f](https://github.com/xuckless/pixl-playroom/commit/e77dc4f6e16b9ad945e92bef5a6e4cfdfa1f0d04))
* colour each mask component on the overlay; Visualise Spots for the Heal tool; fix: the clipping and headroom overlays were upside down ([4078300](https://github.com/xuckless/pixl-playroom/commit/407830079bad6efe178762dac6fc258f46387122))
* crash reports, problem reports in R2 ([4e8a89c](https://github.com/xuckless/pixl-playroom/commit/4e8a89c5a91ff8027a9b493220c3d42e3f040c26))
* Denoise in an area, indexing denoise better ([dd2a452](https://github.com/xuckless/pixl-playroom/commit/dd2a45215b214eedcd7f5a47083ba889e27d92d3))
* end to end tested the updates and release pipeline ([44393cf](https://github.com/xuckless/pixl-playroom/commit/44393cfa8c98b7e3b5b5a16cd748edbb41bde9d4))
* folders open out into a tree, and a Subfolders toggle lists the photos below; the open photo's neighbours get their proxies ahead ([bae02bb](https://github.com/xuckless/pixl-playroom/commit/bae02bb4786cc776ec7002c99e430e527ade8221))
* key bindings editor. ([4f9cfe6](https://github.com/xuckless/pixl-playroom/commit/4f9cfe6ef132c87c5706dbde4f76f6c3b46a8184))
* mask edges: shift and harden on painted, AI and gradient planes (an octagon min/max filter and a levels curve), a lasso's shift and inside feather as a polygon offset; new AI masks start pulled in ([7e71de4](https://github.com/xuckless/pixl-playroom/commit/7e71de4905cbf54656e5450590c77072ce95b1fd))
* masks become detached and powerful and heal/clone brush fix ([2dcb4d3](https://github.com/xuckless/pixl-playroom/commit/2dcb4d333cdafedf2de16109d1f2e145428edde9))
* masks everywhere, .pixl projects, pixel steps and baked heal ([2cb1016](https://github.com/xuckless/pixl-playroom/commit/2cb10161d7b7420a0e180e41d99035fb60b75ced))
* masks run before a black-and-white conversion; built-in presets set only their own sliders ([9d9e42e](https://github.com/xuckless/pixl-playroom/commit/9d9e42e4bf172c9de2b6e54a2208a24c12e6220e))
* mock accounts, tesks and building towards real account support. ([d2fb858](https://github.com/xuckless/pixl-playroom/commit/d2fb85872629dbbaa9d4004c70a5d72d2ecb2701))
* packing and embedding into my own file format ([0c4646a](https://github.com/xuckless/pixl-playroom/commit/0c4646aaac04b397232557d9e91298ac8bb84430))
* road to beta, setting up login, guards, and builders ([44b3068](https://github.com/xuckless/pixl-playroom/commit/44b3068be57d9b5c4218b9ec576c0c3dea8a4cbe))
* the beta terms ship inside the app (Help → Beta Terms, Settings, the beta gate), copied from pixl-web by scripts/legal-copy.mjs; the gate says the beta is free with no warranty and no liability; credit to Syed Ali (PIXL Foundation) ([1e2859a](https://github.com/xuckless/pixl-playroom/commit/1e2859a0a7858238823c0395fe2b0b634935eee6))
* the folder shown is watched; changes made outside the app appear as they happen, and a watched folder is not rescanned on open ([ee49184](https://github.com/xuckless/pixl-playroom/commit/ee491844cc3994cb64abedb2902949dd45479a2c))
* the live mask preview shifts and hardens edges as the engine's planes do; fix: a recipe handed out by reference brings its project's planes into the store (thumbnails of photos not opened this session), and only an engine read failure marks a photo unreadable ([51a4732](https://github.com/xuckless/pixl-playroom/commit/51a47321abefbbb83e777ea7a773c189a324eb26))


### Bug Fixes

* a crop under Upright stays in the picture and never collapses ([9f701d6](https://github.com/xuckless/pixl-playroom/commit/9f701d6699aa7b8a3152e84190c85c75fa2df52e))
* a history step and the recipe are saved together; a failed save is said ([4979e5e](https://github.com/xuckless/pixl-playroom/commit/4979e5e8e9fc97275d41188c7c30b1ab93be5292))
* a project is its photo's by size or hash, not name alone; a renamed photo keeps its project ([96aa69e](https://github.com/xuckless/pixl-playroom/commit/96aa69e7d06691d09d48995c2ec8f010e21b35e9))
* a Subtract left first by a mask part that could not be drawn is dropped, not made an Add ([756aafd](https://github.com/xuckless/pixl-playroom/commit/756aafddfdc2d423e8fdfcc9ad0a08ce71d2fe4a))
* a thumbnail edited while it renders renders again; one render per key ([2c1e1b1](https://github.com/xuckless/pixl-playroom/commit/2c1e1b1b90fb424e9b6071773f94c4386d81d0c5))
* added queue for undo/redo ([3d1c27e](https://github.com/xuckless/pixl-playroom/commit/3d1c27ef6a3d4f1450f44835c2eb976c45956cb9))
* added upright copy section. ([b3f0859](https://github.com/xuckless/pixl-playroom/commit/b3f08596d569379e4a65fae806d3396a778cf622))
* an AI job that kept its step ends done, not cancelled; the save stage can be stopped ([12ae38d](https://github.com/xuckless/pixl-playroom/commit/12ae38d3abab69bd7837a57c6f31c88215843723))
* beta tester updates ([0ca3657](https://github.com/xuckless/pixl-playroom/commit/0ca365761409ab95d9dbf0acf0fc1370f969995c))
* closing a copy keeps the others' lens sets; lens maps written whole; unique freeze names ([d3ec46e](https://github.com/xuckless/pixl-playroom/commit/d3ec46e6812951a3488479a382f57f16e2ad79ed))
* color profile mismatch on heal and clone and fix. With the new ([4100e48](https://github.com/xuckless/pixl-playroom/commit/4100e482fd39223d7aab33a6ee0613969ae505c3))
* confirm holds the keyboard, a downloaded update is kept, finished model parts verified, bitmaps closed, exifr reads bytes not paths ([0d682d0](https://github.com/xuckless/pixl-playroom/commit/0d682d0ff8e1226d3f6412c8ad0babe92c11e652))
* denoise and enhance land after the steps they were made on; preview kept until replaced ([5421421](https://github.com/xuckless/pixl-playroom/commit/54214210c556a659181b51dea1acfe0de33b967e))
* each preview render its own file; a failed lens bake stops holding renders back ([59441b0](https://github.com/xuckless/pixl-playroom/commit/59441b0666a237259c2ef86948234a74b0ab3c0d))
* export compares files, not names, before overwriting the original ([1744240](https://github.com/xuckless/pixl-playroom/commit/1744240a340ede53069f69d8d7114edb12f430b8))
* flip and rotate carry the crop, straighten, aspect and Upright; rotate follows the button when flipped; a tiny straighten is none ([3f1e4d9](https://github.com/xuckless/pixl-playroom/commit/3f1e4d90ee10faeb24d02ad1ab4e24efaa82b7cd))
* heal lens map read by pixel centres, heal size through the correction, proxy patches at their own size, overlay joins masks as compile does ([920eb4b](https://github.com/xuckless/pixl-playroom/commit/920eb4b536ab2d7013fb580619b90edc1937a81d))
* lens at f/0, per-photo CA and profiles on paste and presets, old presets normalised, RAW defaults in sync and presets, locked crops refitted on paste ([86aeab0](https://github.com/xuckless/pixl-playroom/commit/86aeab04784c24d39d6e5aae419804b26ee72b56))
* masks window fix, ([1258b45](https://github.com/xuckless/pixl-playroom/commit/1258b45a1c717102eb0a92348078551db31c19f1))
* one working-set build per key, master after proxies, files written whole ([a0d1416](https://github.com/xuckless/pixl-playroom/commit/a0d141653757485d318bc32c58aca059ece5f7be))
* optimization errors, and some bugs ([57fa60b](https://github.com/xuckless/pixl-playroom/commit/57fa60b23d862cc306734d10c76741e8eeb2fdf0))
* paste and sync in Develop are history steps ([fc1ca17](https://github.com/xuckless/pixl-playroom/commit/fc1ca170f2983b4126cda33f90f13edc1bc432e9))
* **projects:** close a .pixl without DatabaseSync.isOpen ([14f78e6](https://github.com/xuckless/pixl-playroom/commit/14f78e6a5810e54c285fb5327eb4ef67de06e038))
* quit lets the index finish before it closes; a new project's rename is durable before its old copies go ([633e4e7](https://github.com/xuckless/pixl-playroom/commit/633e4e737c47622f13a91fc9286d1c7922c861ae))
* recipes normalised inside arrays, curves strictly increasing, comparisons by value, vignette turned past 45° kept ([ac2207f](https://github.com/xuckless/pixl-playroom/commit/ac2207fad0567b3fe4ddd45508ef3b590371dffd))
* **release:** publish the macOS feed of the release's channel ([628725f](https://github.com/xuckless/pixl-playroom/commit/628725f8a8e2cdd65d40424409538a9b34027ac6))
* **release:** publish the macOS feed of the release's channel ([70045bd](https://github.com/xuckless/pixl-playroom/commit/70045bda50bf41e21113c0e4cb0ce855d71e61ff))
* session management ([13026fe](https://github.com/xuckless/pixl-playroom/commit/13026fe8c7380385ec347bc867dae62760405768))
* Upright's focal length from the focal length and the camera's crop when the file gives no 35 mm figure; heal outlines follow the Upright warp; portrait RAWs checked upright ([d232e4d](https://github.com/xuckless/pixl-playroom/commit/d232e4d0c10d873b282703a2b1b533b46d6120db))


### Performance

* a project's writes gather into one transaction committed within 250 ms (or on leaving Develop, closing and quitting), with full fsync on macOS ([1fff42e](https://github.com/xuckless/pixl-playroom/commit/1fff42ea0ea3849626c23e5cc73a1857ab2f388e))
* a relaunching process leaves before loading the app; the updater and exiftool load when used; a folder listed again skips a fresh scan; thumbnails checked from the row's recipe key; xmp fill yields ([3520e30](https://github.com/xuckless/pixl-playroom/commit/3520e303c5576943622cde7be75dad81eb15eb24))
* background engine work takes its share of the cores at lower priority; auto WB two at a time; a duplicate search stops when you leave it ([0046aa9](https://github.com/xuckless/pixl-playroom/commit/0046aa9af5890bd3b20963975c7acfe804928cd7))
* brushes keyed by their reference, lensKey memoised, shoulder tables keyed by name; probes on the interactive engine and kept on disk; a draft first on open; a whole-frame crop is none ([6df86e0](https://github.com/xuckless/pixl-playroom/commit/6df86e0bb04e079b60525510be4e0f31a042b1be))
* caches kept in bounds: old lens sets pruned as new ones land, replaced and orphaned thumbnails removed, heal leftovers deleted, per-photo caches swept on close; frozen masks keyed on what shapes them ([4cc2655](https://github.com/xuckless/pixl-playroom/commit/4cc2655da60c78e2402df3385fabbf3c4303560b))
* drafts go to the window as pixels on their own port from the engine host, drawn on a canvas: no file, no protocol read, no decode ([efd0873](https://github.com/xuckless/pixl-playroom/commit/efd087337df61c5150fb1df9a5e8ed1f210a1fdb))
* glass holds still while panning, painting and dragging; a still gradient and frosted glass behind dialogs; popovers placed on events; range masks key on settled, smaller pictures; UI state written in batches ([13d2786](https://github.com/xuckless/pixl-playroom/commit/13d27863bf1b944addb01d66a9b605e00f6fb9f9))
* HDR stats through an uncompressed TIFF, JPEG 1:1 tiles, proxy and draft laid on together, the headroom overlay on the GPU ([156d25b](https://github.com/xuckless/pixl-playroom/commit/156d25b9c8961510242fbdb33a23d7638c1e192a))
* history keyframes every 25 steps; an append reads only from the last one and returns just what changed; hide, show and delete send the head ([166dfd9](https://github.com/xuckless/pixl-playroom/commit/166dfd92aa5287d1f23e876ccd48d54d8ce23386))
* history replays with one clone and appends with one read; reads take no lock; saves write only changed items; thumbnails checked from the slim item; origin cache survives own writes ([1fccdf4](https://github.com/xuckless/pixl-playroom/commit/1fccdf4e3ee60c1d3cfd6ac92e67cf4409ba71e7))
* mask planes keyed on what shapes them and measured only for a new picture; small mask thumbnails; JPEG before; 4:2:0 settled previews; plane cache by bytes ([2de9bba](https://github.com/xuckless/pixl-playroom/commit/2de9bba3825780b9600db904ec8cf73b6310e0b4))
* one engine scheduler (background waits behind previews, a render waits for a cancelled one to let go); a 1920 px proxy for settled previews ([986fced](https://github.com/xuckless/pixl-playroom/commit/986fcedd6ff731afdcd66b88733245d42422980d))
* originals and pixel steps stored in pieces off the index's request loop, gc later with a stepped vacuum; thumbnails shrunk from Develop's settled picture ([f5d4054](https://github.com/xuckless/pixl-playroom/commit/f5d4054e0f6c71c648f7b87fd86c0386201807c3))
* painted planes as binary blobs named by SHA-256 (.pixl format 2, upgraded on open; index migration 9); recipes cross between main and the index by reference ([57c32ac](https://github.com/xuckless/pixl-playroom/commit/57c32ac84f203e561cd489866d8447f11834271a))
* slider ticks re-render only what they change (immer), loupe geometry and mask compose memoised, no double sends, no idle polling ([856766e](https://github.com/xuckless/pixl-playroom/commit/856766e468c8462346579552564beb97bb8ae567))
* the library grid and filmstrip virtualised (@tanstack/react-virtual); near duplicates grouped by multi-index hashing, not every pair ([26fcffb](https://github.com/xuckless/pixl-playroom/commit/26fcffb28a5909768fdbd7c5d0c82be98c61d8d3))
* the open photo's project stays open; busy timeouts, transactions and a project index; open asks in parallel; isEdited compares in place; thumbnails wait for a pause ([6bd6633](https://github.com/xuckless/pixl-playroom/commit/6bd6633ad0304ba98fd8aed36b34f74d4f2b5131))
* thumbnails patched once a frame, visible items computed once, stable tile callbacks, deferred search; hello before pruning, the last folder opened alongside the lists; newer lens catalogue only, lazy thread count, background engine deferred; unreadable files remembered ([8167356](https://github.com/xuckless/pixl-playroom/commit/81673561807dbec4f694658737f56c4a53b984e2))

## [0.1.1-beta](https://github.com/xuckless/pixl-playroom/compare/v0.1.0...v0.1.1-beta) (2026-09-30)


### Features

* 3rd party notices ([5ba8c48](https://github.com/xuckless/pixl-playroom/commit/5ba8c48dccaa359bc1179cc870b1e36b4a89ef1c))
* added 3rd party notices etc ([fbd222f](https://github.com/xuckless/pixl-playroom/commit/fbd222f83b7aa69442ac16e9c3fc01fb410cde2f))
* added editable interactive history, working similar to layered history by default. mask renames, and quality of life fixes. ([d229795](https://github.com/xuckless/pixl-playroom/commit/d2297953fcfaa006076b15c61c205250bf516b12))
* added editable interactive history, working similar to layered history by default. mask renames, and quality of life fixes. ([b1c01cb](https://github.com/xuckless/pixl-playroom/commit/b1c01cbd1f42dac9eccc8195aac76404aefcd681))
* added gain maps ([5ffcdf0](https://github.com/xuckless/pixl-playroom/commit/5ffcdf06073258c9c1a8fe043d22188f8cd21ef5))
* added lens profile and chromatic abberation correction ([6cfd3e3](https://github.com/xuckless/pixl-playroom/commit/6cfd3e334038f16236440ca225446bae0216267e))
* added native support for watermarks ([a9e5d83](https://github.com/xuckless/pixl-playroom/commit/a9e5d835ab3ac69b3f42594bb6fd536b6d78a524))
* added new engine bindings and settign it up ([f51b6f9](https://github.com/xuckless/pixl-playroom/commit/f51b6f98ca9c1373c7d6fce20ac94b88454d82e6))
* added stalling prevention and engine stopping/task cancellation, ([3adb47e](https://github.com/xuckless/pixl-playroom/commit/3adb47ed8dfd1554ac1efbb77add8f7cc542d8a2))
* added x2 enhance, export, gainmaps other compatibility features. ([ef75e88](https://github.com/xuckless/pixl-playroom/commit/ef75e88682b495a383c18f4200bbb75242b74a26))
* additive color added, both in effects and masks. ([876906e](https://github.com/xuckless/pixl-playroom/commit/876906e894f513258ed340ea406db1ddbab53cc9))
* **crop:** guides, straighten grid and drag-outside-to-rotate ([e6c80f7](https://github.com/xuckless/pixl-playroom/commit/e6c80f7f814ef79410f8560d365eb0c09b54fa48))
* **develop:** batch auto WB entry points and white balances that cross kinds ([501f5a5](https://github.com/xuckless/pixl-playroom/commit/501f5a57801fdf91d676b81bb3c98d0fadfd556c))
* **develop:** edit title, caption, copyright and keywords in the Info pane ([9a109be](https://github.com/xuckless/pixl-playroom/commit/9a109beba1c1066eb438037d024c48ec1836949a))
* **develop:** gentler, scene-aware auto tone ([0d69c56](https://github.com/xuckless/pixl-playroom/commit/0d69c565a48df752b9f1ef1ff131e91202ecd657))
* **develop:** point colour, targeted adjustment and curve presets ([08108dc](https://github.com/xuckless/pixl-playroom/commit/08108dc283c5a95771f26dc9a5b60f9f3fab52be))
* **develop:** thumb-wheel tool selector with a single tool panel ([0d58cbd](https://github.com/xuckless/pixl-playroom/commit/0d58cbdc8958c6b0a39e5d6a4267f3c0be531f57))
* Enhanced and Jpeg restore ([cb1e438](https://github.com/xuckless/pixl-playroom/commit/cb1e438d1e92e044d7374af48cf3de739f4ae7f4))
* **export:** output sharpening after the resize ([0aad80b](https://github.com/xuckless/pixl-playroom/commit/0aad80ba281e2222afdc03c79108b34d71cf7b2f))
* **export:** output sharpening and metadata controls in the export dialog ([056b442](https://github.com/xuckless/pixl-playroom/commit/056b442607b1c41b71f08580b5393c4e7a055129))
* **export:** title, keywords and copyright written into exports ([ab6aa3a](https://github.com/xuckless/pixl-playroom/commit/ab6aa3a9f10d00aafde661815d2f4fca64ca3dcd))
* **fx:** three.js processing sphere and ambient shader gradient ([354b7ac](https://github.com/xuckless/pixl-playroom/commit/354b7ac45c195582fcc064af1be3f33410194385))
* heal, clone, red eye, pet eye. ([a477b2b](https://github.com/xuckless/pixl-playroom/commit/a477b2b58b8db4975d10cc8b28c7b2bf114ca58c))
* library and develop contracts for the host-only push ([72d27db](https://github.com/xuckless/pixl-playroom/commit/72d27dbc4b2d60021a90e5a0b82c9aede1d57cad))
* **library:** a filter that speaks smart-collection rules, and keyword input helpers ([36fc7a8](https://github.com/xuckless/pixl-playroom/commit/36fc7a8a6947d00646260e47407c4708770766bc))
* **library:** auto white balance per photo across a batch ([4597ad8](https://github.com/xuckless/pixl-playroom/commit/4597ad8c6a670207ab546c7bb3224184d72d9c34))
* **library:** exiftool, xmp sidecars and embedMetadata ([b6e47b6](https://github.com/xuckless/pixl-playroom/commit/b6e47b621f51f49a982d8f2a7149ba05ab070899))
* **library:** library IPC for sources, metadata, collections, stacks, duplicates ([93c820b](https://github.com/xuckless/pixl-playroom/commit/93c820b1e536783f6b932fd288df27368721b47d))
* **library:** restyle the library, its empty state and the dialogs ([173031c](https://github.com/xuckless/pixl-playroom/commit/173031cb7ecea2ab930997e9a498ae5a31ad86bc))
* **library:** smart rules, dhash grouping and stack collapsing ([08ad322](https://github.com/xuckless/pixl-playroom/commit/08ad322f77e128e341ff83fb6e72ede3ccf3a090))
* **library:** sources sidebar, collections, smart rules, stacks, duplicates and an info drawer ([7f4d90d](https://github.com/xuckless/pixl-playroom/commit/7f4d90dadad1c0159a8b3c3731ceeafacf55dc6f))
* **library:** sources, keywords, collections, stacks and duplicates in the index ([e925cfc](https://github.com/xuckless/pixl-playroom/commit/e925cfc6b6918f862678b89a851683eb67f83869))
* Local ai models for noise reduction ([6af7d07](https://github.com/xuckless/pixl-playroom/commit/6af7d07537850f3828c5256d244275aad77305d5))
* **masks:** brush A/B, density, pen pressure, auto mask and editable lasso ([2a8f4ed](https://github.com/xuckless/pixl-playroom/commit/2a8f4edf5442f8fc82e6febdb5efc8f1c2f09e89))
* **masks:** gradients, per-mask amount and range smoothness in the recipe and compiler ([95e1b6f](https://github.com/xuckless/pixl-playroom/commit/95e1b6fcb9a01a31703fccf90b5fe16b9da76fb6))
* **masks:** keys to delete, duplicate, hide, and cycle the overlay ([47308be](https://github.com/xuckless/pixl-playroom/commit/47308be61fe6fb8b5338f0d9e8059ac66915f93b))
* **masks:** Lightroom-style masks panel, tool picker and overlays ([fca5850](https://github.com/xuckless/pixl-playroom/commit/fca5850bac1aa6f52c19b4d6e7e0f4210b93bbf3))
* **masks:** linear and radial gradient tools with on-canvas pins ([240c770](https://github.com/xuckless/pixl-playroom/commit/240c770ea9b3e8d13c48f72da43f762ed025c7a9))
* **masks:** reorder, inline actions, an add bar, and hover previews ([c06e255](https://github.com/xuckless/pixl-playroom/commit/c06e255a65390109c6a846c8e3387311167183b0))
* perspective changes, upright etc. ([1204417](https://github.com/xuckless/pixl-playroom/commit/1204417cb66ef9ab6600dcd7f67f970bdf647308))
* Pixl Playroom, a photo developer on the PIXL engine ([3ab09fd](https://github.com/xuckless/pixl-playroom/commit/3ab09fdd94e9c4a42e20bb0aa47cac5189663b86))
* Pixl Playroom, a photo developer on the PIXL engine ([c215cd5](https://github.com/xuckless/pixl-playroom/commit/c215cd5b11d78a8fef945313e6d5d8fa57d040d2))
* pixl-engine 0.15 — lens, heal, AI denoise and enhance, HDR gain maps, watermark, lens profiles ([cd51181](https://github.com/xuckless/pixl-playroom/commit/cd5118152fd82943d4a59f6102adc4ad3f909fd9))
* **platform:** offer Playroom in Open With on macOS and Windows ([d5fc4a7](https://github.com/xuckless/pixl-playroom/commit/d5fc4a7ca70e3ead2e17b46213414a3aaf5b3b5e))
* **platform:** open photos from Finder and Explorer ([651fea4](https://github.com/xuckless/pixl-playroom/commit/651fea4108bd363b52f8eadfdc984ef4af1002b2))
* Remove all references from github pages, site is down. and ([76bc9fb](https://github.com/xuckless/pixl-playroom/commit/76bc9fb3419bc8d534373162d2c001281ae8b5f2))
* tweaks, remeasures ([ba7681c](https://github.com/xuckless/pixl-playroom/commit/ba7681c317d656221c541cba8b36d08376112ae0))
* **ui:** design tokens, bundled fonts and restyled primitives ([0858fc9](https://github.com/xuckless/pixl-playroom/commit/0858fc986b18b1ff83558ba6513b2a420a115543))
* **ui:** develop shell with two-tier bars, spine rail and filmstrip chip ([e6874eb](https://github.com/xuckless/pixl-playroom/commit/e6874eb111c52fe58907daa63684e4676482c682))
* **ui:** liquid glass surfaces ([a833ea0](https://github.com/xuckless/pixl-playroom/commit/a833ea007709b28f147165b7975ae3d4c86da420))
* WebGL mask preview and AI loading screen ([b0a8f01](https://github.com/xuckless/pixl-playroom/commit/b0a8f0177a3b669e8d169cb2055dce7851cd8b6b))


### Bug Fixes

* **build:** ship every font subset as a file, never a data: URL ([1f04040](https://github.com/xuckless/pixl-playroom/commit/1f0404005db04989f9f407a765092f0c14644109))
* **crop:** crop box survives renders, straightening and undo ([9fe249f](https://github.com/xuckless/pixl-playroom/commit/9fe249ff3a466212ab438c02722583902a9d0dd5))
* **curves:** curve presets update the curve; README refresh ([0bd960c](https://github.com/xuckless/pixl-playroom/commit/0bd960c7228ccf9dd3749beaec05511386382dbc))
* denoise wasnt rendering a 'before' picture. ([3feffa5](https://github.com/xuckless/pixl-playroom/commit/3feffa52dfc77e872fd11236370626f3def9ea4a))
* **develop:** auto tone keeps low-key frames dark and hot frames' contrast ([df5d8ce](https://github.com/xuckless/pixl-playroom/commit/df5d8cee52ad776aa9efda2e6765f12a28adc7ec))
* **develop:** keep engine renders from disturbing the loupe ([ca23df3](https://github.com/xuckless/pixl-playroom/commit/ca23df3760e56060359f927f611522e1c5f1f8d1))
* **export:** size a RAW from its developed frame, not its mosaic ([a5e47cb](https://github.com/xuckless/pixl-playroom/commit/a5e47cb0c903a1d8f4f43709bbfc27a7b3fb5796))
* fix the delay caused by lens correction and fringe correction whcih ([a498014](https://github.com/xuckless/pixl-playroom/commit/a49801416a4c4a3415773a0282f5a5a80bbcc353))
* fixing the brush controls on heal and clone. ([1b796d1](https://github.com/xuckless/pixl-playroom/commit/1b796d181c70960534d37c6c9912894c13a37ef2))
* **library:** drop a refresh that lands after another folder opened ([c5e3e7e](https://github.com/xuckless/pixl-playroom/commit/c5e3e7e6493a86484a78567ec757de182cd16666))
* **main:** stop the exporter's ExifTool processes on quit ([c6c127e](https://github.com/xuckless/pixl-playroom/commit/c6c127e1288042a260d485751d51bd841b8a51e9))
* **masks:** a range mask's smoothness softens by feather ([b97d2d9](https://github.com/xuckless/pixl-playroom/commit/b97d2d921e06ea75102d94e8372f461ade20af6d))
* **masks:** deleting, naming and the overlay stay in step with the masks ([ed70c59](https://github.com/xuckless/pixl-playroom/commit/ed70c5943cde5557b96c50a4ff70706cc97f4888))
* **platform:** keep opened photos across the display-scale relaunch ([944fd51](https://github.com/xuckless/pixl-playroom/commit/944fd51d3da45c5e186a196ff72a1f407685651d))
* **platform:** never open the app's own folder from the command line ([54e2e7e](https://github.com/xuckless/pixl-playroom/commit/54e2e7eedf291d6491b6ce9037bcd549934f2297))
* **popover:** menus live above everything, so a mask can be deleted ([39119a3](https://github.com/xuckless/pixl-playroom/commit/39119a3bd8e4af73cf6a9848552a5ec6f1e9bb11))
* the curves options wasnt updating. . . . updated readme. ([f221ff8](https://github.com/xuckless/pixl-playroom/commit/f221ff83b810c0c81e9c1ef2319eeb9ba8d88a6c))
* ui bug where before/after wasnt working ([a9dba61](https://github.com/xuckless/pixl-playroom/commit/a9dba61506ae2cd9b7824fc9f94da4c3cba2b05e))
* ui bug where before/after wasnt working ([3511808](https://github.com/xuckless/pixl-playroom/commit/3511808dd00dd42b271890f2910a7d2a3d035ce3))
* **ui:** keep dialogs' keys to themselves; tidy the tool panel's entrance ([26eda0c](https://github.com/xuckless/pixl-playroom/commit/26eda0c4d701aac1259b54b49094299754a34220))


### Maintenance

* cut releases as betas; publish the lens catalogue to R2 as built ([8f18eca](https://github.com/xuckless/pixl-playroom/commit/8f18eca435dba1138a6eaea71e44e5cb5964eafa))
