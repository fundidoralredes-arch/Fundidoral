document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const form = $('#orderForm');
  const ready = $('#ready');
  const link = $('#waLink');
  const shareDesignBtn = $('#shareDesignBtn');
  const shareStatus = $('#shareStatus');
  const dialog = $('#pieceDialog');
  const menu = $('.menu-toggle');
  const mobileNav = $('#mobile-nav');
  const productSelect = $('#product');
  const designUpload = $('#designUpload');
  const designFileMeta = $('#designFileMeta');
  const uploadReminder = $('#uploadReminder');

  let message = '';
  let uploadedFile = null;

  function readableBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && value >= 1024; i += 1) {
      value /= 1024;
      unit = units[i];
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
  }

  function pick(product) {
    productSelect.value = product;
    form.hidden = false;
    ready.hidden = true;
    $('#formStep').textContent = '01 / CONFIGURA';
  }

  if (menu) {
    menu.addEventListener('click', () => {
      const open = menu.getAttribute('aria-expanded') === 'true';
      menu.setAttribute('aria-expanded', String(!open));
      mobileNav.hidden = open;
      menu.querySelector('span').textContent = open ? '＋' : '−';
    });
  }

  $$('#mobile-nav a').forEach((a) => a.addEventListener('click', () => {
    mobileNav.hidden = true;
    menu.setAttribute('aria-expanded', 'false');
    menu.querySelector('span').textContent = '＋';
  }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      mobileNav.hidden = true;
      menu.setAttribute('aria-expanded', 'false');
      menu.querySelector('span').textContent = '＋';
    }
  });

  $$('.piece').forEach((b) => b.addEventListener('click', () => {
    $('#dialogImage').src = b.dataset.image;
    $('#dialogImage').alt = b.querySelector('img').alt;
    $('#dialogTitle').textContent = b.dataset.title;
    $('#dialogQuote').dataset.product = b.dataset.product;
    dialog.showModal();
    document.body.classList.add('lock');
  }));

  $$('.text-link[data-pick]').forEach((a) => a.addEventListener('click', () => pick(a.dataset.pick)));
  $('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => document.body.classList.remove('lock'));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    }
  });
  $('#dialogQuote').addEventListener('click', () => {
    pick($('#dialogQuote').dataset.product);
    dialog.close();
  });

  productSelect.addEventListener('change', () => {
  });

  designUpload.addEventListener('change', () => {
    uploadedFile = designUpload.files && designUpload.files[0] ? designUpload.files[0] : null;
    if (uploadedFile) {
      designFileMeta.hidden = false;
      designFileMeta.textContent = `Archivo seleccionado: ${uploadedFile.name} · ${readableBytes(uploadedFile.size)}`;
    } else {
      designFileMeta.hidden = true;
      designFileMeta.textContent = '';
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const qty = Number($('#quantity').value);
    if (!form.reportValidity() || !Number.isInteger(qty) || qty < 1) return;

    const uploadLine = uploadedFile
      ? `Archivo de diseño: ${uploadedFile.name} (${readableBytes(uploadedFile.size)})`
      : 'Archivo de diseño: No adjunto';

    const extraNote = uploadedFile
      ? 'Diseño: incluido con esta solicitud.'
      : 'Diseño: no adjunto.';

    message = [
      'Hola, equipo Fundidoral. Quisiera solicitar una cotización:',
      '',
      `Producto: ${productSelect.value}`,
      `Material: ${$('#material').value}`,
      `Cantidad: ${qty} piezas`,
      `Medidas: ${$('#size').value.trim() || 'Por definir'}`,
      `Acabado: ${$('#finish').value}`,
      `Detalles: ${$('#details').value.trim() || 'Por definir'}`,
      uploadLine,
      extraNote,
      '',
      'Quedo atento/a a su respuesta.'
    ].join('\n');

    link.href = `https://wa.me/584242018095?text=${encodeURIComponent(message)}`;
    $('#waFallback').href = `https://api.whatsapp.com/send?phone=584242018095&text=${encodeURIComponent(message)}`;
    $('#messagePreview').textContent = message;
    uploadReminder.hidden = !uploadedFile;
    if (shareStatus) shareStatus.textContent = '';
    form.hidden = true;
    ready.hidden = false;
    $('#formStep').textContent = '02 / REVISA Y ENVÍA';
    $('#copyStatus').textContent = '';
    ready.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
    link.focus({ preventScroll: true });
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  });

  async function shareDesignAndQuote() {
    if (shareStatus) shareStatus.textContent = '';

    if (!uploadedFile) {
      window.location.href = link.href;
      return;
    }

    const canShareFile = navigator.share && (!navigator.canShare || navigator.canShare({ files: [uploadedFile] }));
    if (canShareFile) {
      try {
        if (shareStatus) shareStatus.textContent = 'Selecciona WhatsApp y luego el chat de Fundidoral para enviar el archivo adjunto.';
        await navigator.share({
          title: 'Cotización Fundidoral',
          text: message,
          files: [uploadedFile]
        });
        if (shareStatus) shareStatus.textContent = 'Cotización compartida.';
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (shareStatus) shareStatus.textContent = 'Envío cancelado. Puedes intentarlo de nuevo.';
          return;
        }
      }
    }

    if (shareStatus) {
      shareStatus.textContent = 'Este navegador no puede transferir el archivo directamente a WhatsApp. Abriremos el chat con el mensaje preparado.';
    }
    window.location.href = link.href;
  }

  shareDesignBtn.addEventListener('click', shareDesignAndQuote);

  $('#editBtn').addEventListener('click', () => {
    ready.hidden = true;
    form.hidden = false;
    $('#formStep').textContent = '01 / CONFIGURA';
    productSelect.focus({ preventScroll: true });
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  });

  $('#copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message);
      $('#copyStatus').textContent = 'Mensaje copiado.';
    } catch {
      $('#copyStatus').textContent = 'Selecciona el mensaje para copiarlo o abre WhatsApp.';
    }
  });

  $$('.reel-card video').forEach((video) => {
    video.addEventListener('play', () => {
      $$('.reel-card video').forEach((other) => {
        if (other !== video) other.pause();
      });
    });
    video.addEventListener('error', () => {
      const status = video.parentElement.querySelector('.video-status');
      if (status) status.hidden = false;
    });
    const retry = video.parentElement.querySelector('.retry-video');
    if (retry) {
      retry.addEventListener('click', () => {
        const status = video.parentElement.querySelector('.video-status');
        if (status) status.hidden = true;
        video.load();
        video.play().catch(() => {});
      });
    }
  });

  const activeSections = $$('.section-track');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        $$('.rail a').forEach((a) => {
          const active = a.hash === `#${entry.target.id}`;
          a.classList.toggle('active', active);
          if (active) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        });
      }
    });
  }, { rootMargin: '-20% 0px -45% 0px' });
  activeSections.forEach((s) => observer.observe(s));

  let ticking = false;
  addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        $('.header').classList.toggle('scrolled', scrollY > 40);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  const gallery = $('.hero-gallery');
  const track = $('.carousel-track');
  const group = $('.carousel-group');
  const pause = $('#carouselPause');
  if (window.gsap && gallery && track && group && pause) {
    const clone = group.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.append(clone);
    let motion;
    let paused = reduced;
    let inView = true;
    const sync = () => {
      if (motion) {
        if (paused || !inView || document.hidden) motion.pause();
        else motion.play();
      }
    };
    const build = () => {
      const progress = motion ? motion.progress() : 0;
      motion?.kill();
      gsap.set(track, { x: 0 });
      motion = gsap.to(track, {
        x: () => -group.getBoundingClientRect().width,
        duration: 20,
        ease: 'none',
        repeat: -1,
        paused: true
      });
      motion.progress(progress);
      sync();
    };
    const label = () => {
      pause.textContent = paused ? 'Reproducir carrusel ▶' : 'Pausar carrusel Ⅱ';
      pause.setAttribute('aria-pressed', String(paused));
    };
    pause.addEventListener('click', () => {
      paused = !paused;
      label();
      sync();
    });
    new IntersectionObserver((entries) => {
      inView = entries[0].isIntersecting;
      sync();
    }).observe(gallery);
    document.addEventListener('visibilitychange', sync);
    new ResizeObserver(build).observe(gallery);
    label();
    build();
  } else if (pause) {
    pause.hidden = true;
  }

  if (!reduced && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from('.hero h1 .line>span', { yPercent: 110, duration: 1.1, stagger: 0.13 }, 0.1)
      .from('.hero-reveal', { opacity: 0, y: 20, duration: 0.85, stagger: 0.14 }, 0.35)
      .from('.hero-gallery', { opacity: 0, y: 65, duration: 1.2 }, 0.45);

    $$('.reveal').forEach((el) => gsap.from(el, {
      y: 30,
      opacity: 0,
      duration: 0.9,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true }
    }));

    const mm = gsap.matchMedia();
    mm.add('(min-width: 701px)', () => {
      $$('.story').forEach((section) => {
        const img = section.querySelector('.product-image');
        gsap.fromTo(img, { yPercent: 3, scale: 0.96 }, {
          yPercent: -3,
          scale: 1,
          ease: 'none',
          scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom top', scrub: 1 }
        });
        gsap.from(section.querySelectorAll('.story-copy > *'), {
          y: 30,
          opacity: 0,
          stagger: 0.09,
          duration: 0.8,
          scrollTrigger: { trigger: section, start: 'top 70%', once: true }
        });
      });
      gsap.from('.piece', {
        y: 45,
        opacity: 0,
        stagger: 0.13,
        duration: 0.9,
        scrollTrigger: { trigger: '.collection-grid', start: 'top 85%', once: true }
      });
      gsap.from('.step', {
        y: 30,
        opacity: 0,
        stagger: 0.13,
        duration: 0.8,
        scrollTrigger: { trigger: '.steps', start: 'top 80%', once: true }
      });
    });

    mm.add('(max-width: 700px)', () => {
      $$('.story-visual').forEach((el) => gsap.from(el, {
        opacity: 0,
        y: 25,
        duration: 0.7,
        scrollTrigger: { trigger: el, start: 'top 90%', once: true }
      }));
    });

    addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }

});
