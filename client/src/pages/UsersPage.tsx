import { useState } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";

export default function UsersPage() {
  const utils = trpc.useUtils();
  const { data: usersList, isLoading } = trpc.users.list.useQuery();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">유저 관리</h2>
          <p className="text-sm text-gray-500">시스템 유저를 관리하세요</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          <Plus size={16} />
          유저 추가
        </button>
      </div>

      {showCreate && <CreateUserForm onDone={() => { setShowCreate(false); utils.users.list.invalidate(); }} />}

      {isLoading ? (
        <div className="text-sm text-gray-400 py-8 text-center">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">이름</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">아이디</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">역할</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">연락처</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">상태</th>
              </tr>
            </thead>
            <tbody>
              {usersList?.map((u: any) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">@{u.username}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded ${u.role === "admin" ? "bg-purple-50 text-purple-700" : "bg-gray-50 text-gray-600"}`}>
                      {u.role === "admin" ? "관리자" : "일반"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{u.phone || u.email || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs ${u.isActive ? "text-green-600" : "text-gray-400"}`}>
                      {u.isActive ? "활성" : "비활성"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [phone, setPhone] = useState("");

  const create = trpc.users.create.useMutation({
    onSuccess() { toast.success("유저가 생성되었습니다"); onDone(); },
    onError(err) { toast.error(err.message); },
  });

  return (
    <div className="bg-white rounded-lg border border-blue-200 p-4 mb-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 *" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="아이디 *" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 *" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="전화번호" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      <select value={role} onChange={(e) => setRole(e.target.value as any)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
        <option value="user">일반</option>
        <option value="admin">관리자</option>
      </select>
      <div className="flex gap-2">
        <button onClick={() => create.mutate({ username, password, name, role, phone })} disabled={!username || !password || !name} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">생성</button>
        <button onClick={onDone} className="px-4 py-2 text-gray-600 text-sm rounded-lg hover:bg-gray-50">취소</button>
      </div>
    </div>
  );
}
