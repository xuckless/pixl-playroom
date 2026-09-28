// Pixl Playroom website: the before/after slider, the hero video (plays only
// while on screen, and not at all under reduced motion) and the phone nav.
;(function () {
  'use strict'
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  // ── nav ──────────────────────────────────────────────────────
  var nav = document.querySelector('.nav')
  var toggle = nav && nav.querySelector('.nav-toggle')
  if (toggle) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open)
      toggle.setAttribute('aria-expanded', String(open))
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
    }
    toggle.addEventListener('click', function () {
      setOpen(!nav.classList.contains('open'))
    })
    nav.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        setOpen(false)
      })
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false)
        toggle.focus()
      }
    })
  }

  // Disabled download buttons do nothing.
  document.querySelectorAll('.b-cta[aria-disabled="true"]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault()
    })
  })

  // ── hero video ───────────────────────────────────────────────
  var video = document.querySelector('.hero-win video')
  var vidBtn = document.querySelector('.vid-toggle')
  if (video) {
    video.muted = true
    var visible = false
    var userPaused = reduced.matches
    var sync = function () {
      var want = visible && !userPaused && !document.hidden
      if (want && video.paused) {
        var p = video.play()
        if (p && p.catch)
          p.catch(function () {
            // Autoplay refused (a saver mode, a strict browser): the poster stays.
          })
      } else if (!want && !video.paused) {
        video.pause()
      }
      if (vidBtn) {
        vidBtn.setAttribute('aria-pressed', String(userPaused))
        vidBtn.querySelector('.label').textContent = userPaused ? 'Play' : 'Pause'
      }
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          visible = entries[0].isIntersecting
          sync()
        },
        { threshold: 0.05 }
      ).observe(video)
    } else {
      visible = true
    }
    document.addEventListener('visibilitychange', sync)
    reduced.addEventListener &&
      reduced.addEventListener('change', function () {
        userPaused = reduced.matches
        sync()
      })
    if (vidBtn) {
      vidBtn.hidden = false
      vidBtn.addEventListener('click', function () {
        userPaused = !userPaused
        sync()
      })
    }
    sync()
  }

  // ── before / after ───────────────────────────────────────────
  var ba = document.querySelector('.ba')
  if (ba) {
    var range = ba.querySelector('input[type="range"]')
    var cap = document.querySelector('.ba-cap')
    var imgs = {
      before: ba.querySelector('.ba-before'),
      after: ba.querySelector('.ba-after')
    }
    var setPos = function (v) {
      v = Math.max(0, Math.min(100, v))
      ba.style.setProperty('--pos', v + '%')
      range.value = String(Math.round(v))
      range.setAttribute(
        'aria-valuetext',
        Math.round(v) + '% before, ' + (100 - Math.round(v)) + '% after'
      )
    }
    var fromPointer = function (e) {
      var r = ba.getBoundingClientRect()
      setPos(((e.clientX - r.left) / r.width) * 100)
    }
    var dragging = false
    ba.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return
      dragging = true
      ba.setPointerCapture(e.pointerId)
      fromPointer(e)
      range.focus({ preventScroll: true })
    })
    ba.addEventListener('pointermove', function (e) {
      if (dragging) fromPointer(e)
    })
    var stop = function () {
      dragging = false
    }
    ba.addEventListener('pointerup', stop)
    ba.addEventListener('pointercancel', stop)
    range.addEventListener('input', function () {
      setPos(Number(range.value))
    })
    setPos(Number(range.value))

    // Switching pairs: swap both pictures' sources.
    var srcs = function (id, side, ext) {
      var base = 'assets/pairs/' + id + '-' + side + '-'
      return base + '1200.' + ext + ' 1200w, ' + base + '2400.' + ext + ' 2400w'
    }
    var show = function (btn) {
      var id = btn.getAttribute('data-id')
      ;['before', 'after'].forEach(function (side) {
        var pic = imgs[side]
        pic.querySelector('source').srcset = srcs(id, side, 'webp')
        var img = pic.querySelector('img')
        img.srcset = srcs(id, side, 'jpg')
        img.src = 'assets/pairs/' + id + '-' + side + '-1200.jpg'
        img.alt = (side === 'before' ? 'Before: ' : 'After: ') + btn.getAttribute('data-alt')
      })
      cap.textContent = btn.getAttribute('data-cap')
      document.querySelectorAll('.ba-thumbs button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn))
      })
    }
    document.querySelectorAll('.ba-thumbs button').forEach(function (b) {
      b.addEventListener('click', function () {
        show(b)
      })
    })
  }
})()
