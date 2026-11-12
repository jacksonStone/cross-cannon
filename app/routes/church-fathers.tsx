import type { MetaFunction } from "@remix-run/node";
import { WorkReader } from "~/features/work-reader/WorkReader";
export {
  churchFathersLoader as loader,
  churchFathersAction as action,
} from "~/features/early-christian-reader/route.server";
export const meta: MetaFunction = () => [
  { title: "Early Christian Reader | Cross Canon" },
  {
    name: "description",
    content: "Read and search early Christian works in chapter context.",
  },
];
export default WorkReader;
