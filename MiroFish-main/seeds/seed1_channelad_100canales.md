# SEED 1: Simulacion de adquisicion de 100 primeros canales para ChannelAd

## Contexto del Producto

ChannelAd es un marketplace de publicidad en canales cerrados (Telegram, WhatsApp, Discord, newsletters). Conecta anunciantes con owners de canales que tienen audiencias activas en comunidades cerradas. El modelo de negocio cobra una comision por cada campana ejecutada.

## Situacion Inicial

- Presupuesto de adquisicion: 0 euros
- Unico activo disponible: una lista de 200 contactos de owners de canales hispanohablantes
- Programa Canal Fundador: los primeros 50 registrados obtienen comision preferencial permanente (15% en lugar de 25%) y una campana garantizada en los primeros 30 dias
- Lanzamiento publico: aproximadamente 30 dias despues del inicio de la campana de registro
- No hay anunciantes registrados todavia
- La plataforma esta funcional pero sin contenido

## Perfiles de Agentes

### Owners de Canales de Telegram (80 contactos)
- Canales de nicho: criptomonedas, trading, tecnologia, marketing digital
- Tamano tipico: 500-15,000 suscriptores
- Motivacion principal: monetizar su audiencia sin perder autenticidad
- Dolor actual: negocian publicidad manualmente via DM, sin garantias de pago
- Nivel de confianza en plataformas nuevas: bajo-medio
- Tiempo de respuesta a DMs: 24-72 horas

### Owners de Canales de WhatsApp (60 contactos)
- Comunidades de nicho: fitness, recetas, maternidad, emprendimiento, viajes
- Tamano tipico: 100-2,000 miembros
- Motivacion: nunca han monetizado, curiosidad alta pero desconocimiento del proceso
- Dolor actual: no saben cuanto cobrar ni como encontrar anunciantes
- Nivel de confianza: medio (WhatsApp es mas personal)
- Tiempo de respuesta: 12-48 horas

### Owners de Canales de Discord (40 contactos)
- Servidores de nicho: gaming, desarrollo de software, comunidades de creadores
- Tamano tipico: 200-5,000 miembros
- Motivacion: buscan ingresos pasivos para mantener el servidor
- Dolor actual: solo conocen Patreon o donaciones, no publicidad contextual
- Nivel de confianza: bajo (comunidad tecnica, esceptica)
- Tiempo de respuesta: 48-96 horas

### Owners de Newsletters (20 contactos)
- Newsletters de nicho: finanzas personales, productividad, noticias tech
- Tamano tipico: 1,000-10,000 suscriptores
- Motivacion: ya monetizan parcialmente, buscan diversificar
- Dolor actual: dependen de 1-2 sponsors fijos, sin marketplace
- Nivel de confianza: medio-alto (mas profesionales)
- Tiempo de respuesta: 24-48 horas

## Tres Variantes de Campana

### Variante A: Outreach Directo Frio (DM uno a uno)
- Mensaje personalizado por canal, referenciando su nicho y tamano estimado de audiencia
- CTA: registro como Canal Fundador con beneficios exclusivos
- Sin automatizacion, maximo 10-15 contactos por dia
- Seguimiento a los 3 dias si no hay respuesta
- Segundo seguimiento a los 7 dias con dato de interes (ej: "ya hay 12 canales de tu nicho")
- Tasa esperada de respuesta: 15-25%
- Tasa esperada de conversion (respuesta a registro): 30-50%

### Variante B: Referral Activado desde el Primer Registro
- Los primeros 5 canales que se registran reciben creditos de campana (valor 50 euros) si traen a otros 3 canales
- Cada canal referido que se registra genera 15 euros en creditos para el referidor
- Mecanica: link personalizado de referral + tracking
- Efecto bola de nieve dentro de comunidades de creators
- Dependencia critica: necesita masa critica inicial (minimo 5 registros activos)
- Riesgo: registros de baja calidad motivados solo por el credito

### Variante C: Contenido Publico + SEO en Espanol
- Articulos posicionados en "como monetizar tu canal de Telegram", "publicidad en WhatsApp grupos", "monetizar servidor Discord"
- Publicacion en blog propio + Medium + LinkedIn
- Los canales llegan inbound a la landing de registro
- Tasa de conversion: menor (2-5%) pero coste cero y efecto acumulativo
- Tiempo de indexacion SEO: 2-4 semanas para primeros resultados
- Volumen estimado de trafico organico en semana 4: 200-500 visitas

## Variables de Simulacion

- Duracion: 30 dias
- Metrica principal: numero de canales registrados
- Metricas secundarias: tasa de respuesta, tiempo medio de conversion, calidad de canales (tamano audiencia), distribucion por plataforma
- Evento critico: primera campana publicada (dia ~15-20)
- Efecto cascada: cada campana ejecutada genera prueba social que acelera registros

## Fricciones Esperadas

1. Desconfianza: "otra plataforma mas que promete y no cumple"
2. Falta de anunciantes: "me registro pero nadie va a comprar publicidad en mi canal"
3. Proceso de registro: si requiere mas de 3 minutos, abandonan
4. Verificacion del canal: si piden acceso al canal, muchos se niegan
5. Competencia de atencion: owners reciben muchos DMs spam, el mensaje se pierde
6. Barrera de WhatsApp: compartir link de grupo con una plataforma desconocida genera rechazo

## Pregunta Central de Simulacion

Cual de las tres variantes o combinacion de ellas alcanza 100 canales registrados en 30 dias partiendo solo de una lista de contactos? Que friccion aparece primero en cada variante, que perfil de canal adopta antes, y que senal externa (ej: primera campana publicada) podria acelerar el efecto cascada?
