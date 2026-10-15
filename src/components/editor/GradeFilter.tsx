import { useEffect, useMemo } from "react";
import { gradeTables, tableValues, type ColorGrade } from "../../lib/colorGrade";
import { lutAxis, useLutCache } from "../../lib/gradePreview";

/** Renk düzeltmenin önizleme süzgeci (kanal başına tablo). `id` ile CSS'te
 * `url(#id)` olarak kullanılır. */
export function GradeFilter({ id, grade }: { id: string; grade: ColorGrade | undefined }) {
  const lutPath = grade?.lut?.path;
  const axis = useLutCache((s) => (lutPath ? s.axes[lutPath] : undefined));
  // LUT henüz okunmadıysa okumaya başlar (bittiğinde süzgeç yeniden çizilir).
  useEffect(() => {
    if (lutPath) lutAxis(lutPath);
  }, [lutPath]);
  const values = useMemo(() => {
    const tables = gradeTables(grade, axis ?? null);
    return tables.map((t) => tableValues(t));
  }, [grade, axis]);
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="table" tableValues={values[0]} />
          <feFuncG type="table" tableValues={values[1]} />
          <feFuncB type="table" tableValues={values[2]} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
