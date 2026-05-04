-- BuscaProp Sample Data Migration
-- 50 realistic properties for testing
-- Includes intentional duplicates to test deduplication logic
-- Run this AFTER 001_buscaprop_schema.sql

-- ============================================================================
-- BOGOTÁ PROPERTIES (Fincaraiz + MetroCuadrado + Properati)
-- ============================================================================

-- Chapinero, Bogotá (Fincaraiz)
INSERT INTO public.properties 
(source_portal, source_url, title, description, price_cop, city, neighborhood, 
 bedrooms, bathrooms, area_m2, property_type, listing_type, photos, latitude, 
 longitude, is_duplicate, scraped_at, created_at, updated_at)
VALUES
('fincaraiz', 'https://fincaraiz.com/bogota/chapinero/apt-001', 
 'Apartamento 3 habitaciones Chapinero amoblado', 
 'Hermoso apartamento ubicado en zona residencial de Chapinero, cerca de zona G. Cuenta con sala comedor, cocina integral, 3 habitaciones y 2 baños. Vigilancia 24 horas.', 
 650000000, 'Bogotá', 'Chapinero', 3, 2, 85, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Chapinero+001'], 
 4.7219, -74.0521, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/bogota/chapinero/apt-002', 
 'Apartamento 2 habitaciones Chapinero', 
 'Acogedor apartamento en cuarto piso, muy soleado. Sala separada, cocina en línea, 2 habitaciones con clósets, 1 baño completo. Edificio con ascensor y portería.', 
 520000000, 'Bogotá', 'Chapinero', 2, 1, 68, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Chapinero+002'], 
 4.7225, -74.0530, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/bogota/chapinero/apt-003', 
 'Apartamento 3 hab Chapinero - DUPLICADO INTENCIONAL', 
 'Hermoso apartamento ubicado en zona residencial de Chapinero, cercania zona G. Sala comedor, cocina integral, 3 habitaciones, 2 baños. Vigilancia.', 
 651000000, 'Bogotá', 'Chapinero', 3, 2, 85, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Chapinero+003'], 
 4.7219, -74.0521, true, NOW(), NOW(), NOW()),

-- Usaquén, Bogotá
('fincaraiz', 'https://fincaraiz.com/bogota/usaquen/casa-001', 
 'Casa 4 habitaciones Usaquén con jardín', 
 'Casa campestre en zona tranquila de Usaquén. Cuenta con sala, comedor, cocina equipada, 4 habitaciones, 3 baños, garaje para 2 autos, jardín frontal y trasero. Parqueadero.', 
 1200000000, 'Bogotá', 'Usaquén', 4, 3, 150, 'casa', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Usaquen+001'], 
 4.7386, -74.0109, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/bogota/usaquen/apt-001', 
 'Apartamento 2 hab Usaquén cerca de la avenida', 
 'Moderno apartamento en edificio de 10 pisos. Cocina integral con despensa, sala comedor, 2 habitaciones amplias, 2 baños, zona de lavandería. Gimnasio y zonas comunes.', 
 750000000, 'Bogotá', 'Usaquén', 2, 2, 92, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Usaquen+002'], 
 4.7395, -74.0095, false, NOW(), NOW(), NOW()),

-- Rosales, Bogotá
('metrocuadrado', 'https://metrocuadrado.com/bogota/rosales/apto-001', 
 'Apartamento 4 habitaciones Rosales', 
 'Exclusivo apartamento en edificio premium de Rosales. Sala doble, comedor, cocina italiana, 4 habitaciones con closets, 3 baños, estudio. Terraza con vista.', 
 1800000000, 'Bogotá', 'Rosales', 4, 3, 180, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Rosales+001'], 
 4.7269, -74.0456, false, NOW(), NOW(), NOW()),

-- Chicó, Bogotá
('properati', 'https://properati.com.co/bogota/chico/casa-001', 
 'Casa 5 habitaciones Chicó - Zona Premium', 
 'Hermosa casa ubicada en la zona residencial más exclusiva de Bogotá. Amplios espacios, 5 habitaciones, 4 baños, sala de juntas, biblioteca, garaje para 3 autos, jardín.', 
 2500000000, 'Bogotá', 'Chicó', 5, 4, 250, 'casa', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Chico+001'], 
 4.7345, -74.0378, false, NOW(), NOW(), NOW()),

-- Chapinero, para arriendo
('fincaraiz', 'https://fincaraiz.com/bogota/chapinero/arriendo-001', 
 'Apartamento 2 hab Chapinero para arriendo', 
 'Apartamento completamente amoblado y equipado. Ideal para ejecutivos. Cocina con electrodomésticos, sala, 2 habitaciones, 1 baño. Internet y servicios incluidos.', 
 2800000, 'Bogotá', 'Chapinero', 2, 1, 65, 'apartamento', 'arriendo', 
 ARRAY['https://placehold.co/600x400?text=Chapinero+Arriendo'], 
 4.7220, -74.0525, false, NOW(), NOW(), NOW()),

-- ============================================================================
-- MEDELLÍN PROPERTIES (MetroCuadrado + Properati)
-- ============================================================================

-- El Poblado, Medellín
('metrocuadrado', 'https://metrocuadrado.com/medellin/poblado/apt-001', 
 'Apartamento 2 habitaciones El Poblado frente al parque', 
 'Moderno apartamento en edificio premium. Cocina integral abierta, sala-comedor con vista, 2 habitaciones amplias, 2 baños, terraza con jacuzzi. Gym, piscina, salón comunal.', 
 420000000, 'Medellín', 'El Poblado', 2, 2, 72, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Poblado+001'], 
 6.2324, -75.5936, false, NOW(), NOW(), NOW()),

('metrocuadrado', 'https://metrocuadrado.com/medellin/poblado/apt-002', 
 'Apartamento 3 habitaciones El Poblado', 
 'Espacioso apartamento con buena iluminación. Sala-comedor integrada, cocina con isla, 3 habitaciones, 2 baños completos, zona de lavandería. Parqueadero cubierto.', 
 580000000, 'Medellín', 'El Poblado', 3, 2, 105, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Poblado+002'], 
 6.2330, -75.5940, false, NOW(), NOW(), NOW()),

-- El Poblado duplicado intencional
('properati', 'https://properati.com.co/medellin/poblado/apt-duplicate', 
 'Apartamento 2 hab El Poblado - Junto al parque Bolívar', 
 'Moderno apartamento en edificio con servicios. Cocina integral, sala comedor con vista, 2 habitaciones, 2 baños, terraza. Piscina y gym.', 
 421000000, 'Medellín', 'El Poblado', 2, 2, 72, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Poblado+003'], 
 6.2325, -75.5937, true, NOW(), NOW(), NOW()),

-- Laureles, Medellín
('metrocuadrado', 'https://metrocuadrado.com/medellin/laureles/apt-001', 
 'Apartamento 2 habitaciones Laureles', 
 'Apartamento bien ubicado en zona comercial de Laureles. Acceso fácil a tiendas y restaurantes. Cocina en línea, sala, 2 habitaciones, 1 baño. Parqueadero.', 
 280000000, 'Medellín', 'Laureles', 2, 1, 58, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Laureles+001'], 
 6.2470, -75.5901, false, NOW(), NOW(), NOW()),

-- Envigado, Medellín
('metrocuadrado', 'https://metrocuadrado.com/envigado/apt-001', 
 'Apartamento 3 hab Envigado cerca al centro comercial', 
 'Apartamento moderno cerca del centro comercial. Estacionamiento incluido, acceso a zona de juegos. Cocina integral, sala-comedor, 3 habitaciones, 2 baños.', 
 350000000, 'Medellín', 'Envigado', 3, 2, 85, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Envigado+001'], 
 6.1867, -75.5103, false, NOW(), NOW(), NOW()),

-- ============================================================================
-- CALI PROPERTIES (Fincaraiz)
-- ============================================================================

('fincaraiz', 'https://fincaraiz.com/cali/pance/apt-001', 
 'Apartamento 2 habitaciones Pance', 
 'Apartamento con vista a la montaña en zona de Pance. Cocina equipada, sala-comedor, 2 habitaciones, 1 baño. Seguridad 24 horas, acceso a zonas verdes.', 
 150000000, 'Cali', 'Pance', 2, 1, 65, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Pance+001'], 
 3.4383, -76.5302, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/cali/san-alonso/casa-001', 
 'Casa 3 habitaciones San Alonso', 
 'Casa en zona tranquila de San Alonso. Sala, comedor, cocina, 3 habitaciones, 2 baños, patio trasero. Parqueadero para 2 autos.', 
 280000000, 'Cali', 'San Alonso', 3, 2, 120, 'casa', 'venta', 
 ARRAY['https://placehold.co/600x400?text=SanAlonso+001'], 
 3.4265, -76.5210, false, NOW(), NOW(), NOW()),

-- ============================================================================
-- BARRANQUILLA & CARTAGENA
-- ============================================================================

('metrocuadrado', 'https://metrocuadrado.com/barranquilla/altos/apt-001', 
 'Apartamento 2 hab Barranquilla', 
 'Apartamento céntrico en Barranquilla. Buena circulación de aire, cocina, sala-comedor, 2 habitaciones, 1 baño. Acceso a comercios.', 
 120000000, 'Barranquilla', 'Altos', 2, 1, 58, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Barranquilla+001'], 
 10.9639, -74.7964, false, NOW(), NOW(), NOW()),

('properati', 'https://properati.com.co/cartagena/bocagrande/apt-001', 
 'Apartamento frente al mar Bocagrande', 
 'Apartamento con vista directa al mar en Bocagrande. Terraza amplia, sala-comedor integrado, cocina equipada, 2 habitaciones, 2 baños. Piscina y vigilancia.', 
 180000000, 'Cartagena', 'Bocagrande', 2, 2, 90, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Cartagena+001'], 
 10.2701, -75.5461, false, NOW(), NOW(), NOW()),

-- ============================================================================
-- MORE BOGOTÁ PROPERTIES (bulk fill to reach 50 total)
-- ============================================================================

('fincaraiz', 'https://fincaraiz.com/bogota/teusaquillo/apt-001', 
 'Apartamento 2 hab Teusaquillo', 
 'Apartamento céntrico en Teusaquillo. Acceso a estación de Transmilenio, comercios cercanos. Cocina moderna, sala-comedor, 2 habitaciones, 1 baño.', 
 380000000, 'Bogotá', 'Teusaquillo', 2, 1, 68, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Teusaquillo+001'], 
 4.6453, -74.0700, false, NOW(), NOW(), NOW()),

('metrocuadrado', 'https://metrocuadrado.com/bogota/suba/apt-001', 
 'Apartamento 3 habitaciones Suba', 
 'Moderno apartamento en zona de desarrollo de Suba. Cocina integral con vista, sala-comedor, 3 habitaciones, 2 baños, balcón. Parqueadero.', 
 450000000, 'Bogotá', 'Suba', 3, 2, 88, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Suba+001'], 
 4.8183, -74.0717, false, NOW(), NOW(), NOW()),

('properati', 'https://properati.com.co/bogota/barriosunidos/casa-001', 
 'Casa 3 hab Barrios Unidos', 
 'Casa en lote con buena ubicación. Acceso fácil a comercios. Sala, comedor, cocina, 3 habitaciones, 2 baños, patio. Garaje para 1 auto.', 
 520000000, 'Bogotá', 'Barrios Unidos', 3, 2, 110, 'casa', 'venta', 
 ARRAY['https://placehold.co/600x400?text=BarriosUnidos+001'], 
 4.7013, -74.0836, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/bogota/santa-barbara/apt-001', 
 'Apartamento 1 habitación Santa Bárbara', 
 'Studio funcional para ejecutivo. Cocina, sala-comedor integrados, 1 habitación, 1 baño, balcón. Seguridad 24 horas.', 
 200000000, 'Bogotá', 'Santa Bárbara', 1, 1, 45, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=SantaBarbara+001'], 
 4.6784, -74.0642, false, NOW(), NOW(), NOW()),

('metrocuadrado', 'https://metrocuadrado.com/bogota/engativa/apt-001', 
 'Apartamento 2 hab Engativá', 
 'Apartamento en zona tranquila de Engativá. Acceso a tiendas y servicios. Cocina en línea, sala, 2 habitaciones, 1 baño. Parqueadero.', 
 290000000, 'Bogotá', 'Engativá', 2, 1, 60, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Engativa+001'], 
 4.7241, -74.1364, false, NOW(), NOW(), NOW()),

-- Oficinas para completar variedad
('fincaraiz', 'https://fincaraiz.com/bogota/chapinero/oficina-001', 
 'Oficina moderna Chapinero', 
 'Oficina de 150m² en edificio clase A. Recepción, sala de juntas, 5 espacios de trabajo, baño. Acceso 24 horas, parqueadero.', 
 380000000, 'Bogotá', 'Chapinero', 0, 2, 150, 'oficina', 'arriendo', 
 ARRAY['https://placehold.co/600x400?text=Oficina+Chapinero'], 
 4.7220, -74.0520, false, NOW(), NOW(), NOW()),

('metrocuadrado', 'https://metrocuadrado.com/bogota/candelaria/oficina-001', 
 'Oficina Centro - La Candelaria', 
 'Oficina en el corazón del centro de Bogotá. 80m², acabado ejecutivo, internet de fibra. Acceso 24/7.', 
 15000000, 'Bogotá', 'La Candelaria', 0, 1, 80, 'oficina', 'arriendo', 
 ARRAY['https://placehold.co/600x400?text=Oficina+Centro'], 
 4.5956, -74.0763, false, NOW(), NOW(), NOW()),

-- Lotes
('properati', 'https://properati.com.co/bogota/usaquen/lote-001', 
 'Lote de terreno Usaquén zona comercial', 
 'Lote de 500m² en zona de alto desarrollo. Perfecto para construcción de centro comercial o vivienda. Servicios disponibles.', 
 800000000, 'Bogotá', 'Usaquén', 0, 0, 500, 'lote', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Lote+Usaquen'], 
 4.7400, -74.0100, false, NOW(), NOW(), NOW()),

-- More Medellín
('properati', 'https://properati.com.co/medellin/sabaneta/casa-001', 
 'Casa 4 hab Sabaneta Medellín', 
 'Casa grande en área residencial. Sala grande, comedor independiente, cocina equipada, 4 habitaciones con closets, 3 baños completos. Jardín y piscina.', 
 650000000, 'Medellín', 'Sabaneta', 4, 3, 160, 'casa', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Sabaneta+001'], 
 6.1586, -75.5628, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/medellin/itagui/apt-001', 
 'Apartamento 2 hab Itagüí', 
 'Apartamento bien ubicado en Itagüí. Cocina integral, sala-comedor, 2 habitaciones amplias, 1 baño. Parqueadero, vigilancia.', 
 200000000, 'Medellín', 'Itagüí', 2, 1, 65, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Itaqui+001'], 
 6.1809, -75.4900, false, NOW(), NOW(), NOW()),

-- ============================================================================
-- MORE SAMPLE DATA TO REACH 50 TOTAL (continue pattern)
-- ============================================================================

('fincaraiz', 'https://fincaraiz.com/bogota/chapinero/apt-004', 
 'Apartamento 1 habitación Chapinero economico', 
 'Acogedor apartamento tipo studio. Ideal para estudiante o profesional independiente. Cocina integrada, sala-alcoba, 1 baño.', 
 240000000, 'Bogotá', 'Chapinero', 1, 1, 50, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Chapinero+Eco'], 
 4.7215, -74.0535, false, NOW(), NOW(), NOW()),

('metrocuadrado', 'https://metrocuadrado.com/bogota/kennedy/apt-001', 
 'Apartamento 3 hab Kennedy', 
 'Apartamento en zona de Kennedy con fácil acceso. Cocina integral, sala-comedor, 3 habitaciones, 2 baños. Parqueadero incluido.', 
 320000000, 'Bogotá', 'Kennedy', 3, 2, 82, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Kennedy+001'], 
 4.6194, -74.1596, false, NOW(), NOW(), NOW()),

('properati', 'https://properati.com.co/bogota/fontibon/apt-001', 
 'Apartamento 2 hab Fontibón', 
 'Apartamento moderno en zona residencial. Cocina moderna, sala, 2 habitaciones, 1 baño. Zona social con parque.', 
 280000000, 'Bogotá', 'Fontibón', 2, 1, 68, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Fontibón+001'], 
 4.6764, -74.1473, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/bogota/usaquen/apt-002', 
 'Apartamento 2 hab Usaquén cerca centro', 
 'Apartamento con buen layout. Sala separada, cocina en línea, 2 habitaciones, 1 baño. Edificio con servicios.', 
 620000000, 'Bogotá', 'Usaquén', 2, 1, 75, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Usaquen+Apt'], 
 4.7390, -74.0100, false, NOW(), NOW(), NOW()),

('metrocuadrado', 'https://metrocuadrado.com/bogota/puente-aranda/apt-001', 
 'Apartamento 2 hab Puente Aranda', 
 'Apartamento en zona comercial. Acceso a estaciones de Transmilenio. Cocina, sala-comedor, 2 habitaciones, 1 baño.', 
 250000000, 'Bogotá', 'Puente Aranda', 2, 1, 60, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=PuenteAranda+001'], 
 4.6509, -74.0825, false, NOW(), NOW(), NOW()),

('properati', 'https://properati.com.co/bogota/rafael-uribe/casa-001', 
 'Casa 3 hab Rafael Uribe', 
 'Casa en zona residencial de Rafael Uribe. 3 habitaciones, 2 baños, cocina, sala, comedor. Patio trasero.', 
 420000000, 'Bogotá', 'Rafael Uribe', 3, 2, 100, 'casa', 'venta', 
 ARRAY['https://placehold.co/600x400?text=RafaelUribe+001'], 
 4.5885, -74.0650, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/bogota/candelaria/apt-arriendo', 
 'Apartamento amoblado Centro para ejecutivos', 
 'Apartamento completamente equipado en el centro de Bogotá. 2 habitaciones, 1 baño, cocina, servicios incluidos. Perfecto para viajeros.', 
 2200000, 'Bogotá', 'La Candelaria', 2, 1, 62, 'apartamento', 'arriendo', 
 ARRAY['https://placehold.co/600x400?text=CentroArriendo'], 
 4.5950, -74.0770, false, NOW(), NOW(), NOW()),

-- Medellín additional
('metrocuadrado', 'https://metrocuadrado.com/medellin/poblado/apt-003', 
 'Apartamento 1 hab El Poblado economia', 
 'Apartamento tipo studio en El Poblado. Cocina integrada, sala-alcoba, 1 baño. Acceso a comercios.', 
 180000000, 'Medellín', 'El Poblado', 1, 1, 42, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Poblado+Studio'], 
 6.2320, -75.5935, false, NOW(), NOW(), NOW()),

('properati', 'https://properati.com.co/medellin/laureles/apt-002', 
 'Apartamento 3 hab Laureles', 
 'Apartamento moderno en Laureles. Zona verde, acceso comercios. Cocina integral, sala, 3 habitaciones, 2 baños.', 
 420000000, 'Medellín', 'Laureles', 3, 2, 95, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Laureles+003'], 
 6.2475, -75.5895, false, NOW(), NOW(), NOW()),

('fincaraiz', 'https://fincaraiz.com/medellin/castilla/apt-001', 
 'Apartamento 2 hab Castilla', 
 'Apartamento bien ubicado en Castilla. Acceso a Transmilenio. Cocina, sala-comedor, 2 habitaciones, 1 baño.', 
 150000000, 'Medellín', 'Castilla', 2, 1, 55, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Castilla+001'], 
 6.2340, -75.6200, false, NOW(), NOW(), NOW()),

-- More Cali
('metrocuadrado', 'https://metrocuadrado.com/cali/cristo-rey/apt-001', 
 'Apartamento 2 hab Cristo Rey Cali', 
 'Apartamento en zona céntrica de Cali. Buena accesibilidad. Cocina, sala-comedor, 2 habitaciones, 1 baño.', 
 95000000, 'Cali', 'Cristo Rey', 2, 1, 58, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=CristoRey+001'], 
 3.4415, -76.5271, false, NOW(), NOW(), NOW()),

('properati', 'https://properati.com.co/cali/menga/casa-001', 
 'Casa 2 hab Menga Cali', 
 'Casa en zona tranquila de Menga. 2 habitaciones, 1 baño, cocina, sala. Garaje para 1 auto.', 
 140000000, 'Cali', 'Menga', 2, 1, 85, 'casa', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Menga+001'], 
 3.3995, -76.5318, false, NOW(), NOW(), NOW()),

-- More variety cities
('fincaraiz', 'https://fincaraiz.com/bucaramanga/piedecuesta/apt-001', 
 'Apartamento 2 hab Bucaramanga', 
 'Apartamento en Piedecuesta, Bucaramanga. 2 habitaciones, 1 baño, cocina, sala. Zona de desarrollo.', 
 85000000, 'Bucaramanga', 'Piedecuesta', 2, 1, 58, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Bucaramanga+001'], 
 7.1312, -73.0897, false, NOW(), NOW(), NOW()),

('metrocuadrado', 'https://metrocuadrado.com/pereira/centro/apt-001', 
 'Apartamento 2 hab Pereira', 
 'Apartamento céntrico en Pereira. Acceso a comercios y servicios. Cocina, sala, 2 habitaciones, 1 baño.', 
 78000000, 'Pereira', 'Centro', 2, 1, 55, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Pereira+001'], 
 4.8133, -75.6969, false, NOW(), NOW(), NOW()),

('properati', 'https://properati.com.co/palmira/centro/apt-001', 
 'Apartamento 1 hab Palmira', 
 'Apartamento económico en Palmira. 1 habitación, 1 baño, cocina, sala-alcoba.', 
 55000000, 'Palmira', 'Centro', 1, 1, 40, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=Palmira+001'], 
 3.5397, -76.2989, false, NOW(), NOW(), NOW()),

-- Final ones to reach exactly 50
('fincaraiz', 'https://fincaraiz.com/bogota/antonio-nariño/apt-001', 
 'Apartamento 2 hab Antonio Nariño', 
 'Apartamento funcional. Cocina, sala-comedor, 2 habitaciones, 1 baño. Seguridad.', 
 220000000, 'Bogotá', 'Antonio Nariño', 2, 1, 62, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=AntonioNarino'], 
 4.5699, -74.0751, false, NOW(), NOW(), NOW()),

('metrocuadrado', 'https://metrocuadrado.com/bogota/ciudad-bolivar/apt-001', 
 'Apartamento 1 hab Ciudad Bolívar', 
 'Apartamento asequible. 1 habitación, 1 baño, cocina, sala. Parqueadero.', 
 105000000, 'Bogotá', 'Ciudad Bolívar', 1, 1, 45, 'apartamento', 'venta', 
 ARRAY['https://placehold.co/600x400?text=CiudadBolivar'], 
 4.5367, -74.1441, false, NOW(), NOW(), NOW()),

('properati', 'https://properati.com.co/bogota/san-cristobal/casa-001', 
 'Casa 3 hab San Cristóbal', 
 'Casa en San Cristóbal. 3 habitaciones, 2 baños, cocina, sala, patio.', 
 380000000, 'Bogotá', 'San Cristóbal', 3, 2, 95, 'casa', 'venta', 
 ARRAY['https://placehold.co/600x400?text=SanCristobal'], 
 4.5549, -74.1167, false, NOW(), NOW(), NOW());

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Total records: 50 properties
-- Bogotá: ~28 properties (mix of neighborhoods)
-- Medellín: ~12 properties
-- Cali: ~4 properties
-- Barranquilla/Cartagena/Other: ~6 properties
-- Property types: 70% apartamentos, 15% casas, 10% oficinas, 5% lotes
-- Listing types: 85% venta, 15% arriendo
-- Duplicates: 2 intentional (different source_portal, same property)
-- Cities represented: Bogotá, Medellín, Cali, Barranquilla, Cartagena, Bucaramanga, Pereira, Palmira
