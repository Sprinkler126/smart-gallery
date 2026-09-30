# Brand logo drop-in directory

Put optional camera or device brand logos here. The EXIF frame generator checks this folder before falling back to text-only brand rendering.

The app exposes a user-initiated base-pack download from the public Dependencies tab. It downloads the approved manufacturer list from https://worldvectorlogo.com/ into this local directory.

Naming convention:

- `canon.svg`
- `nikon.svg`
- `sony.svg`
- `fujifilm.svg`
- `apple.svg`
- `dji.svg`

Supported formats: `svg`, `png`, `jpg`, `jpeg`, `webp`.

`lumix.png` is the transparent LUMIX text logo from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Lumix_logo.svg), which identifies it as a public-domain text logo and notes its trademark status.

Other downloaded logo files remain ignored by Git. Before downloading the WorldVectorLogo pack, users must accept its terms and remain responsible for trademark and copyright compliance.
