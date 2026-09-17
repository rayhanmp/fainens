WITH candidate_colors(position, color) AS (
  VALUES
    (1, '#6C757D'), (2, '#9C6644'), (3, '#B5179E'), (4, '#264653'),
    (5, '#A44A3F'), (6, '#2D6A4F'), (7, '#C77DFF'), (8, '#F15BB5'),
    (9, '#355070'), (10, '#778DA9'), (11, '#9A031E'), (12, '#0F7173'),
    (13, '#6A4C93'), (14, '#9B5DE5'), (15, '#4D908E'), (16, '#F9844A'),
    (17, '#90BE6D'), (18, '#277DA1'), (19, '#B08968'), (20, '#F94144'),
    (21, '#43AA8B'), (22, '#577590'), (23, '#B56576'), (24, '#6D597A')
), preserved_categories AS (
  SELECT category.id, category.color
  FROM category
  WHERE category.color IS NOT NULL
    AND category.id = (
      SELECT MIN(first_category.id)
      FROM category AS first_category
      WHERE upper(first_category.color) = upper(category.color)
    )
), categories_to_recolor AS (
  SELECT category.id, row_number() OVER (ORDER BY category.id) AS position
  FROM category
  WHERE category.color IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM preserved_categories
      WHERE preserved_categories.id = category.id
    )
), available_colors AS (
  SELECT candidate_colors.color, row_number() OVER (ORDER BY candidate_colors.position) AS position
  FROM candidate_colors
  WHERE NOT EXISTS (
    SELECT 1 FROM preserved_categories
    WHERE upper(preserved_categories.color) = upper(candidate_colors.color)
  )
)
UPDATE category AS target
SET color = (
  SELECT available_colors.color
  FROM categories_to_recolor
  JOIN available_colors USING (position)
  WHERE categories_to_recolor.id = target.id
)
WHERE target.id IN (SELECT id FROM categories_to_recolor);
--> statement-breakpoint
CREATE UNIQUE INDEX category_color_unique_idx
ON category(upper(color))
WHERE color IS NOT NULL;
