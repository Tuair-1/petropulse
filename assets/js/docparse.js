/* ============================================================
 * docparse.js — Word/PDF 本地解析(共享模块)
 * 所有解析在浏览器本地完成,文件不上传
 * ============================================================ */
window.PP_DOC = {
  /* 解析文件:返回 { text, ext } ; onProg(0~1) 进度回调(仅 PDF 分页时) */
  async parse(file, onProg) {
    const buf = await file.arrayBuffer();
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'docx') {
      const res = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return { text: res.value, ext };
    }
    if (ext === 'pdf') {
      /* 注意:动态 import 在外部经典脚本中按脚本自身 URL 解析相对路径,
         必须基于 document.baseURI 显式构造(兼容子路径部署与镜像站) */
      const base = document.baseURI;
      const pdfjs = await import(new URL('assets/js/vendor/pdf.min.mjs', base).href);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/js/vendor/pdf.worker.min.mjs', base).href;
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const pages = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        pages.push(tc.items.map(i => i.str).join(' '));
        if (onProg) onProg(p / doc.numPages);
      }
      return { text: pages.join('\n'), ext };
    }
    throw new Error('仅支持 .pdf 与 .docx 文件');
  },

  /* 文本分块(重叠) */
  chunk(text, size = 3800, overlap = 200) {
    const out = [];
    for (let i = 0; i < text.length; i += size - overlap) out.push(text.slice(i, i + size));
    return out;
  }
};
