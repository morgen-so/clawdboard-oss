/**
 * Render a schema.org object as an application/ld+json script tag.
 *
 * `<` is escaped as \u003c (identical once JSON-parsed): user-controlled
 * strings (team names, display names) flow into this payload, and a literal
 * `</script>` inside it would otherwise close the tag early and inject
 * markup into the page.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
