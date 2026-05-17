import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

const root = process.cwd()
const src = path.join(root, 'public', 'crickethub-logo.svg')
const resRoot = path.join(root, 'android', 'app', 'src', 'main', 'res')

const densities = [
  { name: 'mdpi', size: 48 },
  { name: 'hdpi', size: 72 },
  { name: 'xhdpi', size: 96 },
  { name: 'xxhdpi', size: 144 },
  { name: 'xxxhdpi', size: 192 },
]

const makeBgIcon = async (size) => {
  const canvas = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: '#0b1422',
    },
  }).png().toBuffer()

  const logo = await sharp(src)
    .resize(Math.round(size * 0.8), Math.round(size * 0.8), { fit: 'contain' })
    .png()
    .toBuffer()

  return sharp(canvas)
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer()
}

const makeFgIcon = async (size) => {
  return sharp(src)
    .resize(Math.round(size * 0.86), Math.round(size * 0.86), { fit: 'contain' })
    .extend({
      top: Math.round(size * 0.07),
      bottom: Math.round(size * 0.07),
      left: Math.round(size * 0.07),
      right: Math.round(size * 0.07),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize(size, size)
    .png()
    .toBuffer()
}

for (const d of densities) {
  const dir = path.join(resRoot, `mipmap-${d.name}`)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const bgIcon = await makeBgIcon(d.size)
  const fgIcon = await makeFgIcon(d.size)

  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), bgIcon)
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), bgIcon)
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), fgIcon)
}

console.log('Launcher icons regenerated from splash logo')
