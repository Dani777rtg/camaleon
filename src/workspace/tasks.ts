import type { tasks_v1 } from "googleapis";
import type { Tarea, Tareas } from "./tipos.js";

const LISTA = "@default";
const aTarea = (t: tasks_v1.Schema$Task): Tarea => ({
  id: t.id ?? "",
  titulo: t.title ?? "",
  notas: t.notes ?? undefined,
  vence: t.due?.slice(0, 10) ?? undefined,
  estado: t.status === "completed" ? "completada" : "pendiente",
});

/** Google Tasks: lista de tareas por defecto de la cuenta. */
export function crearTareas(api: tasks_v1.Tasks): Tareas {
  return {
    async listar(incluirCompletadas = false) {
      const { data } = await api.tasks.list({ tasklist: LISTA, showCompleted: incluirCompletadas, showHidden: incluirCompletadas, maxResults: 50 });
      return (data.items ?? []).map(aTarea);
    },
    async crear(titulo, notas, vence) {
      const { data } = await api.tasks.insert({
        tasklist: LISTA,
        requestBody: { title: titulo, notes: notas, due: vence ? `${vence}T00:00:00.000Z` : undefined },
      });
      return aTarea(data);
    },
    async completar(id) {
      const { data } = await api.tasks.patch({ tasklist: LISTA, task: id, requestBody: { status: "completed" } });
      return aTarea(data);
    },
  };
}
