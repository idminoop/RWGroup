import assert from 'node:assert/strict'
import { promoteImageToFront, selectComplexCoverImage } from '../../src/lib/images.ts'

function run(): void {
  const hero = '/uploads/admin-hero.jpg'

  const promoted = promoteImageToFront(
    ['https://example.com/img-1.jpg', hero, 'https://example.com/img-2.jpg', ''],
    hero,
  )
  assert.deepEqual(promoted, [hero, 'https://example.com/img-1.jpg', 'https://example.com/img-2.jpg'])

  const coverFromImages = selectComplexCoverImage({
    images: ['/uploads/catalog-cover.jpg', '/uploads/admin-hero.jpg'],
    landing: { hero_image: hero },
  })
  assert.equal(coverFromImages, '/uploads/catalog-cover.jpg')

  const coverFromHeroFallback = selectComplexCoverImage({
    images: ['https://example.com/layout/plan.png'],
    landing: { hero_image: hero },
  })
  assert.equal(coverFromHeroFallback, hero)

  const coverFromHeroWithoutImages = selectComplexCoverImage({
    landing: { hero_image: hero },
  })
  assert.equal(coverFromHeroWithoutImages, hero)

  console.log('[smoke-complex-cover-image] OK')
}

run()
