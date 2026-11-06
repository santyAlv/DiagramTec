/** Inicio (ruta /): presentación y sección "Sobre nosotros". */
import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <section className="page-container figma-home-page">
      <article className="figma-home-hero">
        <h1>Bienvenido a DiagramTec</h1>
        <p>
          La plataforma para crear diagramas de forma intuitiva y descargarlos en PNG o PDF.
        </p>
        <div className="figma-home-auth-actions">
          <Link className="primary-button figma-home-login-button" to="/editor">+ Crear diagrama</Link>
        </div>
      </article>

      <section className="figma-home-block" id="sobre-nosotros">
        <h2>Sobre nosotros</h2>
        <div className="figma-about-grid">
          <div>
            <h3>¿Quiénes somos?</h3>
            <p>
              Somos un equipo de desarrollo perteneciente a la E.E.S.T. N°1 de Monte Grande,
              especializado en la orientación de Programación. Nuestro proyecto, Diagram Tec,
              nace bajo la supervisión del profesor Diego Callamullo con el firme propósito de
              modernizar las herramientas de aprendizaje técnico dentro de nuestra institución.
            </p>
            <p>Nuestro equipo esta conformado por:</p>
            <ul>
              <li><strong>Líder Back-End:</strong> Maite Vazquez.</li>
              <li><strong>Marketing:</strong> Nayla Gomez.</li>
              <li><strong>Desarrollo de Front-End:</strong> Santiago Alvarez y Leandro Pereyra.</li>
              <li><strong>Documentación y Base de Datos:</strong> Joaquin Villalva.</li>
            </ul>
            <p>
              <strong>Nuestro objetivo</strong><br />
              En el ámbito educativo actual, la representación visual de procesos es fundamental.
              Diagram Tec tiene como objetivo principal proporcionar una plataforma digital interactiva
              que facilite la creación y edición de Diagramas de Flujo de Datos (DFD).
              Buscamos transformar la enseñanza tradicional en una experiencia dinámica, accesible
              y eficiente para toda la comunidad del Tecnológico.
            </p>
            <p>
              <strong>La identidad de DiagramTec</strong><br />
              El nombre Diagram Tec simboliza nuestra esencia: la combinación de la funcionalidad
              técnica de los diagramas con la identidad de nuestra escuela.
            </p>
          </div>
          <div className="figma-about-logo-wrap">
            <img src="/logo2.png" alt="Logo DiagramTec" className="figma-about-logo" />
          </div>
        </div>
      </section>
    </section>
  );
}
